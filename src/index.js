// index.js
require("dotenv").config();
const mysql = require("mysql2/promise");
const schedule = require("node-schedule");
const { fetchBlogPosts } = require("./blogFetcher");
const { saveLatestPosts, extractContentAndImages } = require("./databaseManager");
const { getKSTDatetime } = require("./utils");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4",
});

const LOCATIONS = [
  "B홍대", "일산", "마곡", "서울대", "양재", "신림", 
  "연남", "강남", "사당", "신사", "논현", "문래"
];

async function processLocationPosts(location) {
  const posts = await fetchBlogPosts(location);
  const typeMap = new Map();

  for (const post of posts) {
    const postId = post.link.split("/").pop();
    const postDateFormatted = post.postdate.slice(0, 10).replace(/-/g, "");
    
    const { content, images, type } = await extractContentAndImages(
      postId,
      location, 
      postDateFormatted
    );

    if (type && images) {
      const isNewer = !typeMap.has(type) || new Date(post.postdate) > new Date(typeMap.get(type).postdate);
      
      if (isNewer) {
        typeMap.set(type, { ...post, type, images, content });
      }
    }
  }

  const latestPosts = Array.from(typeMap.values());
  console.log(
    `${location} 지점 처리 완료 - 타입별 최신 포스트 수: ${latestPosts.length}`
  );
  
  return latestPosts;
}

async function processPosts() {
  try {
    const locationPosts = {};

    for (const location of LOCATIONS) {
      locationPosts[location] = await processLocationPosts(location);
    }

    await saveLatestPosts(db, locationPosts);
    console.log("모든 작업 완료");
  } catch (error) {
    console.error("데이터 처리 중 오류 발생:", error.message);
  }
}
schedule.scheduleJob("0 2 * * *", async () => {
  console.clear(); 
  await processPosts();
});

// 초기 실행
processPosts();
