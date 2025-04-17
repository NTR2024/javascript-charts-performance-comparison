/* eslint-disable no-async-promise-executor */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-promise-executor-return */
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'

const config = {
    windowWidth: 2000,
    windowHeight: 1000,
    repeatCount: 10,
    channels: 1,
    save: false,
      //test: 'test-lcjs.html',
    //test: 'test-amcharts.html',
    //test: 'test-anychart.html',
    //test: 'test-apexcharts.html',
    test: 'test-c3js.html',
    //test: 'test-canvasjs.html',
    //test: 'test-chartjs.html',
    //test: 'test-devextreme.html',
    //test: 'test-dvxcharts.html', // works with 2k
    //test: 'test-dygraphs.html',  // draws something but slow
    //test: 'test-echarts.html',
    //test: 'test-epoch.html', // strange test
    //test: 'test-fusioncharts.html', // didn't start
    //test: 'test-plotly.html', // started but timed out
    //test: 'test-scichart.html', // 0.7 sec with 2 Mil
    //test: 'test-shieldui.html',
    //test: 'test-smoothiecharts.html',
    //test: 'test-taucharts.html',
    //test: 'test-googlecharts.html',
    //test: 'test-toastui.html',
    //test: 'test-uplot.html',
    //test: 'test-zingchart.html',
    dataSetSize: 1_000_00,
    feature: 'line',
    timeoutMs: 10000,
}

const browser = await puppeteer.launch({
    headless: false,
    args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--override-plugin-power-saver-for-testing=never',
        '--disable-extensions-http-throttling',
        `--window-size=${config.windowWidth + 100},${config.windowHeight + 200}`,
    ],
})

const median = (numbers) => {
    const len = numbers.length
    if (len % 2 === 1) {
        return numbers[Math.floor(len / 2)]
    }
    return (numbers[len / 2 - 1] + numbers[len / 2]) / 2
}

const runTest = (config) => {
    return new Promise(async (resolve) => {
        const page = await browser.newPage()
        let timeout
        page.on('console', async (msg) => {
            const text = msg.text()
            if (msg.type() === 'error' && !(text.includes('404') || text.includes('ERR_CONNECTION_REFUSED'))) {
                console.error(`Error occurred: ${text}`)
                clearTimeout(timeout)
                resolve({ error: true })
                await page.close()
            }
        })
        await page.setViewport({
            width: config.windowWidth,
            height: config.windowHeight,
        })
        await page.evaluate(() => {
            window.moveTo(0, 0)
            window.resizeTo(screen.width, screen.height)
        })
        await page.exposeFunction('error', async () => {
            console.log('error reported by bench app')
            resolve({ error: true })
            await page.close()
        })
        await page.exposeFunction('testSetup', () => config)
        await page.exposeFunction('testReadyToBegin', async () => {
            const metrics0 = await page.metrics()
            let metrics1
            let loadTimeSeconds
            let loadJSHeapUsedSize
            let loadScriptDurationSeconds

            await page.exposeFunction('loadingTestFinished', async (testStart, testEnd) => {
                const tReceivedMessage = performance.now()
                const buffer = await page.screenshot({ type: 'png' })
                const tAppUnclogged = performance.now()
                const loadingSpeedResultMs = testEnd - testStart + (tAppUnclogged - tReceivedMessage)
                clearTimeout(timeout)
                metrics1 = await page.metrics()
                loadTimeSeconds = loadingSpeedResultMs / 1000
                loadJSHeapUsedSize = metrics1.JSHeapUsedSize - metrics0.JSHeapUsedSize
                loadScriptDurationSeconds = metrics1.ScriptDuration - metrics0.ScriptDuration

                const png = PNG.sync.read(buffer)
                let anyNonWhitePixel = false
                for (let y = 0; y < png.height; y++) {
                    for (let x = 0; x < png.width; x++) {
                        const i = (png.width * y + x) << 2
                        const r = png.data[i]
                        const g = png.data[i + 1]
                        const b = png.data[i + 2]
                        if (r !== 255 || g !== 255 || b !== 255) {
                            anyNonWhitePixel = true
                            break
                        }
                    }
                    if (anyNonWhitePixel) break
                }
                if (!anyNonWhitePixel) {
                    console.log('screenshot is completely white')
                    resolve({ error: true })
                    await page.close()
                }

                // Optional: save screenshot
                fs.writeFileSync(`${config.test}.png`, PNG.sync.write(png))

                resolve({
                    loadTimeSeconds,
                    loadJSHeapUsedSize,
                    loadScriptDurationSeconds,
                })

                await page.close()
            })

            clearTimeout(timeout)
            timeout = setTimeout(async () => {
                console.log('timeout B')
                resolve({ error: true })
                await page.close()
            }, config.timeoutMs || 15000)

            await page.evaluate(() => {
                requestAnimationFrame(() => {
                    window.testStart = window.performance.now()
                    window.testPerform()
                })
            })
        })

        timeout = setTimeout(async () => {
            console.log('timeout A')
            resolve({ error: true })
            await page.close()
        }, 60000)

        await page.goto(`http://localhost:8080/${config.test}`)
    })
}

const results = []
for (let i = 0; i < config.repeatCount; i += 1) {
    const result = await runTest(config)
    console.log(`\t${i + 1}/${config.repeatCount}`, result)
    if (result.error) {
        continue
    }
    results.push(result)
}

if (results.length > 0) {
    const loadTimeSeconds = median(results.map((test) => test.loadTimeSeconds))
    const loadJSHeapUsedSize = median(results.map((test) => test.loadJSHeapUsedSize))
    const loadScriptDurationSeconds = median(results.map((test) => test.loadScriptDurationSeconds))

    const testResults = {
        loadTimeSeconds,
        loadJSHeapUsedSize,
        loadScriptDurationSeconds,
    }

    console.log(`MEDIAN SCORE:${JSON.stringify(testResults)}`)

    if (config.save) {
        let data = {}
        const filePath = path.resolve('data.json')
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath))
        }
        data[config.test] = data[config.test] || {}
        data[config.test][JSON.stringify(config)] = testResults
        fs.writeFileSync(filePath, JSON.stringify(data))
    }
}

await browser.close()
