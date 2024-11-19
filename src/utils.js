const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { createWorker } = require('tesseract.js');

function getKSTDatetime() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(now.getTime() + kstOffset)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function extractTextFromImage(imgUrl) {
  const worker = await createWorker();
  
  try {
  	// await worker.load()
    // await worker.loadLanguage('eng');
    // await worker.initialize('eng');
    
    const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
    const { data: { text } } = await worker.recognize(Buffer.from(response.data));
    
    await worker.terminate();
    return text.toUpperCase();
  } catch (error) {
    console.error('텍스트 추출 실패:', error.message);
    await worker.terminate();
    return '';
  }
}

function determinePostType(text) {
  if (text.includes('RESET SOON')) {
    return '탈거임박';
  } else if (text.includes('RESET COMPLETE')) {
    return '세팅완료';
  } else if (text.includes('SETTING SCHEDULE')) {
    return '세팅일정';
  }
  return null;
}

async function downloadImage(imgUrl, location, postDate, type) {
  const dirPath = path.join(__dirname, `images/${location}/${type}`);
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Check existing files and their dates
  const files = fs.readdirSync(dirPath);
  let existingLatestDate = '00000000';  // YYYYMMDD format
  let existingFileName = '';

  for (const file of files) {
    if (file.endsWith('.jpg')) {
      const fileDate = file.split('.')[0];  // Extract date from filename
      if (fileDate > existingLatestDate) {
        existingLatestDate = fileDate;
        existingFileName = file;
      }
    }
  }

  // Only proceed if the new image is more recent
  if (postDate > existingLatestDate) {
    // Remove the old image if it exists
    if (existingFileName) {
      fs.unlinkSync(path.join(dirPath, existingFileName));
    }

    // Download the new image
    const fileName = `${postDate}.jpg`;
    const filePath = path.join(dirPath, fileName);

    try {
      const response = await axios.get(imgUrl, { responseType: "stream" });
      response.data.pipe(fs.createWriteStream(filePath));
      return new Promise((resolve, reject) => {
        response.data.on("end", () => {
          console.log(`${location} - 이미지 다운로드 성공: ${type}/${fileName} (최신 업데이트)`);
          resolve(`${type}/${fileName}`);
        });
        response.data.on("error", reject);
      });
    } catch (error) {
      console.error("이미지 다운로드 실패:", error.message);
      return "";
    }
  } else {
    console.log(`${type} 타입의 더 최신 이미지가 이미 존재합니다. (${existingLatestDate})`);
    return `${type}/${existingFileName}`;
  }
}

async function generateHTML(location, type, imageFileName) {
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta property="og:type" content="website">
      <meta property="og:title" content="더클라임 ${location} 지점 ${type} 안내">
      <meta property="og:image" content="../${imageFileName}">
      <meta property="og:url" content="https://catdevdog.i234.me:12222/${location}">
      <title>더클라임 ${location} 지점 ${type}</title>
    </head>
    <body>
      <h1>${location} 지점 ${type} 안내</h1>
      <p>더클라임 ${location} 지점의 최신 ${type} 정보를 확인하세요.</p>
      <p>업데이트 날짜: ${imageFileName}</p>
      <img src="https://catdevdog.i234.me:12222/${location}/${imageFileName}"/>
    </body>
    </html>
  `;

  const dirPath = path.join(__dirname, `images/${location}/${type}`);
  const filePath = path.join(dirPath, "index.html");
  fs.writeFileSync(filePath, htmlContent, "utf8");
  console.log(`index.html 파일 생성 완료: ${location}/${type}`);
}

module.exports = {
  getKSTDatetime,
  downloadImage,
  generateHTML,
  extractTextFromImage,
  determinePostType,
};