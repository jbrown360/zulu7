
import http from 'http';

const feedUrl = 'https://www.reddit.com/r/homelab.rss'; // Using the one from previous context
const url = `http://localhost:8080/api/rss?url=${feedUrl}`;

console.log(`Fetching: ${url}`);

http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        // Simple regex to find item blocks and print likely image sources
        const items = data.match(/<entry>[\s\S]*?<\/entry>|<item>[\s\S]*?<\/item>/g);
        if (items) {
            console.log(`Found ${items.length} items. Inspecting first 2:`);
            items.slice(0, 2).forEach((item, i) => {
                console.log(`\n--- Item ${i + 1} ---`);
                const mediaThumb = item.match(/<media:thumbnail[^>]*?>/);
                const mediaContent = item.match(/<media:content[^>]*?>/);
                const content = item.match(/<content[^>]*?>([\s\S]*?)<\/content>/);
                const description = item.match(/<description[^>]*?>([\s\S]*?)<\/description>/);

                console.log("media:thumbnail:", mediaThumb ? mediaThumb[0] : "None");
                console.log("media:content:", mediaContent ? mediaContent[0] : "None");

                if (content) {
                    const imgMatch = content[1].match(/<img[^>]+src="([^">]+)"/);
                    console.log("Image in <content>:", imgMatch ? imgMatch[1] : "None");
                }
                if (description) {
                    const imgMatch = description[1].match(/<img[^>]+src="([^">]+)"/);
                    console.log("Image in <description>:", imgMatch ? imgMatch[1] : "None");
                }

                // Print the raw item content for manual inspection if needed
                console.log("Raw item snippet:", item.substring(0, 500));
            });
        } else {
            console.log("No items found or parsing failed.");
            console.log("Raw XML start:", data.substring(0, 500));
        }
    });
}).on('error', err => console.error(err));
