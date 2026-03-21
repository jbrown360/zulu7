import FastSpeedtest from 'fast-speedtest-api';

async function run() {
    try {
        let speedtest = new FastSpeedtest({
            token: "YXNkZmFzZGZhc2RmYXNkZmFzZGFzZGZhc2RmYXNkZg==", // default Netflix fast API dump token
            verbose: true,
            timeout: 10000,
            https: true,
            urlCount: 5,
            bufferSize: 8,
            unit: FastSpeedtest.UNITS.Mbps
        });

        const speed = await speedtest.getSpeed();
        console.log(`Speed: ${speed} Mbps`);
    } catch (e) {
        console.error("Fast API failed:", e.message);
    }
}
run();
