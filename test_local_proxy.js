
import http from 'http';

const url = 'http://localhost:8080/api/rss?url=https://www.reddit.com/r/homelab.rss';

console.log(`Testing local proxy: ${url}`);

const req = http.get(url, (res) => {
    console.log(`Status Code: ${res.statusCode}`);

    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`Body length: ${body.length}`);
        if (body.length > 0) {
            // Print a chunk that likely contains an entry
            const firstEntry = body.indexOf('<entry>');
            const entryEnd = body.indexOf('</entry>', firstEntry);
            if (firstEntry !== -1 && entryEnd !== -1) {
                console.log("--- First Entry Content ---");
                console.log(body.substring(firstEntry, firstEntry + 1500)); // Print first 1500 chars of entry
                console.log("---------------------------");
            } else {
                console.log("No <entry> found. Preview:");
                console.log(body.substring(0, 1000));
            }
        }
    });
});

req.on('error', (e) => {
    console.error("Request Error:", e);
});
