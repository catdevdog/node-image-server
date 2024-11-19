require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mysql = require("mysql2/promise");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

/**
 * 데이터베이스 설정 및 연결 풀 생성
 */
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4",
});

/**
 * 상수 정의
 */
const POST_TYPES = {
  RESET_SOON: "탈거임박",
  RESET_COMPLETE: "세팅완료",
  SETTING_SCHEDULE: "세팅일정",
};

const IMAGE_PROCESSING = {
  MAX_WIDTH: 2000,
  CROP_HEIGHT: 200,
  // THRESHOLD: 150,
};

const TESSERACT_CONFIG = {
  LANGUAGES: "eng+kor"
};

/**
 * 로깅 유틸리티
 */
const Logger = {
  info: (message) => console.log(`[정보] ${message}`),
  error: (message, error) => console.error(`[오류] ${message}:`, error),
  success: (message) => console.log(`[성공] ${message}`),
  process: (message) => console.log(`[진행] ${message}`),
};

/**
 * 게시물 텍스트 분석하여 타입 분류
 * @param {string} text - 분석할 텍스트
 * @returns {string|null} - 분류된 게시물 타입
 */
const analyzePostType = (text) => {
  if (text.includes("RESET SOON")) return POST_TYPES.RESET_SOON;
  if (text.includes("RESET COMPLETE")) return POST_TYPES.RESET_COMPLETE;
  if (text.includes("SETTING SCHEDULE")) return POST_TYPES.SETTING_SCHEDULE;
  return null;
};

/**
 * 데이터베이스 관련 작업
 */
const DatabaseService = {
  /**
   * 사용 가능한 브랜드 목록 조회
   */
  async getBrandList() {
    try {
      const [rows] = await db.query('SELECT brand_name FROM update_log');
      return rows.map(item => item.brand_name);
    } catch (error) {
      Logger.error('브랜드 목록 조회 실패', error);
      return [];
    }
  },

  /**
   * 특정 브랜드의 최신 게시물 조회
   */
  async getBrandPosts(brandName) {
    try {
      const [rows] = await db.query(`SELECT image_url, image_hash FROM ${brandName}`);
      return rows;
    } catch (error) {
      Logger.error(`${brandName} 브랜드의 게시물 조회 실패`, error);
      return [];
    }
  }
};

/**
 * 파일 시스템 관련 작업
 */
const FileService = {
  /**
   * 디렉토리 생성
   */
  createDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      Logger.success(`디렉토리 생성됨: ${dirPath}`);
    }
  },

  /**
   * 이미지 파일 복사
   */
  copyImage(sourcePath, targetPath) {
    fs.copyFileSync(sourcePath, targetPath);
    Logger.success(`이미지 복사 완료: ${path.basename(targetPath)}`);
  }
};

/**
 * 이미지 처리 관련 작업
 */
const ImageService = {
  /**
   * 이미지 URL에서 파일 다운로드
   */
  async downloadImage(url, filepath) {
    try {
      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
      });

      await new Promise((resolve, reject) => {
        const stream = response.data.pipe(fs.createWriteStream(filepath));
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      Logger.success(`이미지 다운로드 완료: ${path.basename(filepath)}`);
      return filepath;
    } catch (error) {
      Logger.error(`이미지 다운로드 실패 (${url})`, error);
      return null;
    }
  },

  /**
   * 이미지 전처리 작업
   */
  async preprocessImage(inputPath) {
    try {
      const metadata = await sharp(inputPath).metadata();
      const processedBuffer = await sharp(inputPath)
        .extract({
          left: 0,
          top: 0,
          width: metadata.width,
          height: IMAGE_PROCESSING.CROP_HEIGHT,
        })
        .resize({ width: IMAGE_PROCESSING.MAX_WIDTH })
        // .threshold(IMAGE_PROCESSING.THRESHOLD)
        .toBuffer();

      Logger.success('이미지 전처리 완료');
      return processedBuffer;
    } catch (error) {
      Logger.error('이미지 전처리 실패', error);
      return null;
    }
  },

  /**
   * OCR을 통한 텍스트 추출
   */
  async extractText(buffer) {
    try {
      const { data: { text } } = await Tesseract.recognize(
        buffer,
        TESSERACT_CONFIG.LANGUAGES
      );

      Logger.info(`추출된 텍스트:\n${text}`);
      return text;
    } catch (error) {
      Logger.error('텍스트 추출 실패', error);
      return "";
    }
  }
};

/**
 * 게시물 처리 작업
 */
class PostProcessor {
  constructor(brandName) {
    this.brandName = brandName;
    this.baseDir = path.join(__dirname, "images", brandName, "posts");
  }

  /**
   * 게시물 처리 초기화
   */
  async initialize() {
    FileService.createDirectory(this.baseDir);
  }

  /**
   * 단일 게시물 처리
   */
  async processPost(post, index) {
    const { image_url, image_hash } = post;
    const filepath = path.join(this.baseDir, `${index}-${image_hash}.jpg`);

    // 이미지 다운로드
    const savedFilepath = await ImageService.downloadImage(image_url, filepath);
    if (!savedFilepath) return;

    // 이미지 전처리
    const processedBuffer = await ImageService.preprocessImage(savedFilepath);
    if (!processedBuffer) return;

    // 텍스트 추출 및 분석
    const postText = await ImageService.extractText(processedBuffer);
    const postType = analyzePostType(postText);

    if (postType) {
      const typeDir = path.join(this.baseDir, postType);
      FileService.createDirectory(typeDir);
      
      const typeFilePath = path.join(typeDir, `${index}-${image_hash}.jpg`);
      FileService.copyImage(filepath, typeFilePath);
    }
  }
}

/**
 * 메인 실행 함수
 */
const main = async () => {
  try {
    Logger.info('이미지 처리 작업 시작');
    
    // 브랜드 목록 조회
    const brands = await DatabaseService.getBrandList();
    Logger.info(`처리할 브랜드 목록: ${brands.join(', ')}`);

    // 각 브랜드별 처리
    for (const brand of brands) {
      Logger.process(`브랜드 처리 중: ${brand}`);
      
      const processor = new PostProcessor(brand);
      await processor.initialize();

      const posts = await DatabaseService.getBrandPosts(brand);
      
      for (let i = 0; i < posts.length; i++) {
        Logger.process(`게시물 처리 중: ${i + 1}/${posts.length}`);
        await processor.processPost(posts[i], i + 1);
      }
      
      Logger.success(`브랜드 처리 완료: ${brand}`);
    }

    Logger.success('모든 작업이 완료되었습니다.');
  } catch (error) {
    Logger.error('작업 실행 중 오류 발생', error);
    process.exit(1);
  }
};

// 프로그램 실행
main();