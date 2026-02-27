import https from 'https';

const url = 'https://www.reddit.com/r/homelab.rss';

console.log(`Testing fetch for ${url}`);

const request = https.get(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
}, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);

    if (res.statusCode >= 300 && res.statusCode < 400) {
        console.log(`Redirect location: ${res.headers.location}`);
    }

    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`Body length: ${body.length}`);
        if (body.length < 500) console.log(body);
    });
});

request.on('error', (e) => console.error(e));
