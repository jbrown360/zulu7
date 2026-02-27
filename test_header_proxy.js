import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = 8081;

app.use('/', createProxyMiddleware({
    target: 'https://www.google.com',
    changeOrigin: true,
    onProxyRes: (proxyRes, req, res) => {
        // Strip headers that prevent embedding
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-content-security-policy'];
        delete proxyRes.headers['x-webkit-csp'];

        // Ensure standard security headers are also removed if they block frames
        // Some sites use frame-ancestors in CSP
        if (proxyRes.headers['content-security-policy']) {
            proxyRes.headers['content-security-policy'] = proxyRes.headers['content-security-policy']
                .replace(/frame-ancestors\s+[^;]+;?/g, '')
                .replace(/frame-src\s+[^;]+;?/g, '');
        }
    },
    onError: (err, req, res) => {
        res.status(500).send('Proxy Error: ' + err.message);
    }
}));

app.listen(PORT, () => {
    console.log(`POC Proxy running at http://localhost:${PORT}`);
    console.log(`Try embedding this in an iframe to see if it works!`);
});
