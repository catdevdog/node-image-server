// databaseManager.js
const axios = require("axios");
const cheerio = require("cheerio");
const { 
  getKSTDatetime, 
  downloadImage, 
  generateHTML,
  extractTextFromImage,
  determinePostType 
} = require("./utils");

async function saveLatestPosts(db, locationPosts) {
  try {
    const createdAt = getKSTDatetime();

    for (const [location, posts] of Object.entries(locationPosts)) {
      // 기존 데이터 삭제
      await db.query(`DELETE FROM blog_posts WHERE branch = ?`, [location]);

      // 타입별 최신 포스트만 저장
      for (const post of posts) {
        const { title, link, description, postdate, type, images } = post;
        
        await db.query(
          `INSERT INTO blog_posts (branch, title, link, description, post_date, type, base64_image, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            location,
            title,
            link,
            description,
            postdate,
            type,
            images,
            createdAt,
          ]
        );

        await generateHTML(location, type, images);
        console.log(`${location} 지점 ${type} 데이터 저장 완료`);
      }

      // 업데이트 로그 저장
      await db.query(`DELETE FROM update_log WHERE branch = ?`, [location]);
      const types = posts.map(p => p.type).join(',');
      await db.query(
        `INSERT INTO update_log (branch, status, updated_at, type) VALUES (?, ?, ?, ?)`,
        [location, "completed", createdAt, types]
      );
    }
  } catch (error) {
    console.error("데이터베이스 저장 실패:", error.message);
  }
}

async function extractContentAndImages(postId, location, postDate) {
  const link = `https://blog.naver.com/PostView.nhn?blogId=theholdshop&logNo=${postId}`;
  try {
    const { data } = await axios.get(link);
    const $ = cheerio.load(data);
    const content = $(`#post-view${postId} .se-main-container`).text().trim();
    let postType = null;
    const images = [];

    const imagePromises = [];
    $(`#post-view${postId} .se-image-resource`).each((_, element) => {
      if (images.length < 1) {
        let imgUrl = $(element).attr("src");
        if (imgUrl) {
          imgUrl = imgUrl.includes("type=")
            ? imgUrl.replace(/type=[^&]+/, "type=w773")
            : `${imgUrl}?type=w773`;
          
          imagePromises.push(
            (async () => {
              const extractedText = await extractTextFromImage(imgUrl);
              const detectedType = determinePostType(extractedText);
              if (detectedType) {
                postType = detectedType;
                return downloadImage(imgUrl, location, postDate, detectedType);
              }
              return null;
            })()
          );
        }
      }
    });

    const imageResults = await Promise.all(imagePromises);
    const validImages = imageResults.filter(Boolean);
    
    console.log("본문 및 이미지 추출 성공");
    return { 
      content, 
      images: validImages.join(","), 
      type: postType 
    };
  } catch (error) {
    console.error("본문 및 이미지 추출 실패:", error.message);
    return { content: "", images: "", type: null };
  }
}

module.exports = {
  saveLatestPosts,
  extractContentAndImages,
};