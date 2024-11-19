// blogFetcher.js
const axios = require("axios");

async function fetchBlogPosts(location) {
  try {
    const query = `[더클라임${location}] / 실내 클라이밍`;

    const response = await axios.get(
      "https://openapi.naver.com/v1/search/blog",
      {
        params: {
          query,
          display: 100,
          start: 1,
          sort: "date",
        },
        headers: {
          "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
        },
      }
    );
	console.log(query, '검색');
    const filteredPosts = response.data.items.filter((item) => {
	// bloggerlink가 존재하고 특정 블로그 링크를 포함하지 않으면 필터링
	  if (!item.bloggerlink || !item.bloggerlink.includes("blog.naver.com/theholdshop")) {
	    return false;
	  }
	
	  // 제목에서 <b> 태그 제거
	  const title = item.title.replace(/<\/?b>/g, "");
	
	  // 정규식 개선: [더클라임 일산], [더클라임 일산점], [더클라임일산], [더클라임일산점] 모두 포함하도록
	  const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	  const titlePattern = new RegExp(`\\[더클라임\\s*${escapedLocation}(\\s*점)?\\]`);
	  
	  // 제목이 패턴과 일치하면 true 반환
	  return titlePattern.test(title);
	});


    console.log(`${location} 지점 블로그 데이터 가져오기 성공`);
    return filteredPosts;
  } catch (error) {
    console.error(
      `${location} 지점 블로그 데이터 가져오기 실패:`,
      error.message
    );
    return [];
  }
}

module.exports = {
  fetchBlogPosts,
};

// utils.js에 추가될 함수
const createWorker = require('tesseract.js').createWorker;

async function extractTextFromImage(imageUrl) {
  const worker = await createWorker();
  
  try {
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
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
    return '탈거 임박';
  } else if (text.includes('RESET COMPLETE')) {
    return '세팅 완료';
  } else if (text.includes('SETTING SCHEDULE')) {
    return '세팅 일정';
  }
  return null;
}

// databaseManager.js의 extractContentAndImages 함수 수정
async function extractContentAndImages(postId, location, postDate) {
  const link = `https://blog.naver.com/PostView.nhn?blogId=theholdshop&logNo=${postId}`;
  try {
    const { data } = await axios.get(link);
    const $ = cheerio.load(data);
    const content = $(`#post-view${postId} .se-main-container`).text().trim();
    let type = null;
    const images = [];

    const imagePromises = [];
    $(`#post-view${postId} .se-image-resource`).each((_, element) => {
      if (images.length < 1) {
        let imgUrl = $(element).attr("src");
        if (imgUrl) {
          imgUrl = imgUrl.includes("type=")
            ? imgUrl.replace(/type=[^&]+/, "type=w773")
            : `${imgUrl}?type=w773`;
          
          // OCR 처리 추가
          imagePromises.push(
            (async () => {
              const extractedText = await extractTextFromImage(imgUrl);
              const detectedType = determinePostType(extractedText);
              if (detectedType) {
                type = detectedType;
              }
              return downloadImage(imgUrl, location, postDate, type || '미분류');
            })()
          );
        }
      }
    });

    const imageFiles = await Promise.all(imagePromises);
    console.log(`${location} - 본문 및 이미지 추출 성공`);
    return { content, images: imageFiles.join(","), type };
  } catch (error) {
    console.error("본문 및 이미지 추출 실패:", error.message);
    return { content: "", images: "", type: null };
  }
}

// index.js의 processPosts 함수 수정
async function processPosts() {
  try {
    const locationPosts = {};

    for (const location of LOCATIONS) {
      const posts = await fetchBlogPosts(location);
      const processedPosts = [];

      for (const post of posts) {
        const postId = post.link.split("/").pop();
        const postDateFormatted = post.postdate.slice(0, 10).replace(/-/g, "");
        
        const { content, images, type } = await extractContentAndImages(
          postId,
          location,
          postDateFormatted
        );

        if (type) {
          processedPosts.push({
            ...post,
            type,
            images,
            content
          });
        }
      }

      locationPosts[location] = processedPosts;
      console.log(`${location} 지점 처리 완료 - 포스트 수: ${processedPosts.length}`);
    }

    await saveLatestPosts(db, locationPosts);
    console.log("모든 작업 완료");
  } catch (error) {
    console.error("데이터 처리 중 오류 발생:", error.message);
  }
}