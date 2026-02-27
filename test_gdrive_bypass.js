import https from 'node:https';

const videoId = '1nWJ8D9ULYOM9KwfdZSC8R9bf5joPSiAC'; // One of the IDs from the logs
const url = `https://drive.google.com/uc?export=download&id=${videoId}`;

const checkUrl = (targetUrl) => {
    console.log("Checking:", targetUrl);
    const client = targetUrl.startsWith('https') ? https : http;
    client.get(targetUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
    }, (res) => {
        console.log("Status:", res.statusCode);

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http')) {
                const prev = new URL(targetUrl);
                nextUrl = new URL(nextUrl, prev.origin).href;
            }
            checkUrl(nextUrl);
            return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log("Final Headers:", res.headers);
            if (data.includes('confirm=')) {
                const match = data.match(/confirm=([a-zA-Z0-9_-]+)/);
                console.log("Found confirm token:", match ? match[1] : 'not found');
                if (match) {
                    console.log("Bypass URL:", `${targetUrl}&confirm=${match[1]}`);
                }
            } else {
                console.log("No confirm token found. Body length:", data.length);
                console.log("First 1000 chars of body:");
                console.log(data.substring(0, 1000));
            }
        });
    }).on('error', err => {
        console.error("Error:", err.message);
    });
};

checkUrl(url);
