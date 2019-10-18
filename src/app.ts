import { lightningChart, AxisTickStrategies, emptyLine, DataPatterns, AxisScrollStrategies, SolidFill, ColorHEX, UIElementBuilders, UIOrigins, LineSeries, ChartXY, Dashboard, ChartOptions, DashboardBasicOptions, VisibleTicks, FormattingRange, AxisTickStrategy, emptyTick } from "@arction/lcjs"
import { defaultStyle } from "./chartStyle"
import './styles/main.scss'

enum SrcOption {
    mic = 'mic',
    file = 'file',
    truck = 'truck',
    f500_1000_1000 = '500_1000_1000'
}
const truckSrcUrl = 'Truck_driving_by-Jason_Baker-2112866529.wav'
const f500_1000_1000_url = '500_1000_10000.wav'
let listen = false
let src: SrcOption = SrcOption.mic

const mediaDevices = navigator.mediaDevices
const audioCtx = new AudioContext()
const analyzer = audioCtx.createAnalyser()

const timeDomainData = new Uint8Array(analyzer.fftSize)
const frequencyData = new Uint8Array(analyzer.frequencyBinCount)
const frequencyHistoryData = Array.from<Point>(Array(analyzer.frequencyBinCount)).map((_, i) => ({ x: i, y: 0 }))
const frequencyMaxHistoryData = new Uint8Array(analyzer.frequencyBinCount)
interface Point {
    x: number,
    y: number
}

function ArrayBufferToPointArray(buf: Uint8Array, xScaler: (n: number) => number = (n) => n, yScaler: (n: number) => number = (n => n)): Point[] {
    return Array.from(buf).map((p, i) => ({ x: xScaler(i), y: yScaler(p) }))
}

let maxFreqHistChanged = false
let maxFreqTemp = 0

// chart

const lc = lightningChart()

const db = lc.Dashboard({
    containerId: 'chart',
    numberOfColumns: 1,
    numberOfRows: 4
})

db
    .setBackgroundFillStyle(defaultStyle.backgroundFill)
    .setBackgroundStrokeStyle(defaultStyle.backgroundStroke)

const timeDomainChart = createChart(db, { columnIndex: 0, columnSpan: 1, rowIndex: 0, rowSpan: 1 }, 'Time Domain', 'Sample', 'Amplitude', [-1, 1])
const waveformHistoryChart = createChart(db, { columnIndex: 0, columnSpan: 1, rowIndex: 1, rowSpan: 1 }, 'Waveform history', 'Time (s)', 'Amplitude', [-1, 1])

const timeDomainSeries = createSeries(timeDomainChart, 'Time Domain', '#fff')

const frequencyChart = createChart(db, { columnIndex: 0, columnSpan: 1, rowIndex: 2, rowSpan: 2 }, 'Spectrum', 'Frequency (Hz)', 'dB', [0, 256])

function createSeries(chart: ChartXY, name: string, color: string): LineSeries {
    return chart.addLineSeries({
        dataPattern: DataPatterns.horizontalProgressive
    })
        .setStrokeStyle(defaultStyle.series.stroke.setFillStyle(new SolidFill({ color: ColorHEX(color) })))
        .setName(name)
        .setCursorInterpolationEnabled(false)
}

function createChart(db: Dashboard, co: DashboardBasicOptions, title: string, xAxisTitle: string, yAxisTitle: string, yInterval: [number, number]): ChartXY {
    const chart = db.createChartXY({
        ...co,
        chartXYOptions: {
            // hack
            defaultAxisXTickStrategy: Object.assign({}, AxisTickStrategies.Numeric),
            defaultAxisYTickStrategy: AxisTickStrategies.Numeric,
            autoCursorBuilder: defaultStyle.autoCursor
        }
    })
        .setBackgroundFillStyle(defaultStyle.backgroundFill)
        .setBackgroundStrokeStyle(defaultStyle.backgroundStroke)
        .setTitle(title)
    chart
        .getAxes().forEach(axis => {
            axis.setTickStyle(defaultStyle.axis.tick)
        })
    chart.getDefaultAxisX()
        .setScrollStrategy(AxisScrollStrategies.progressive)
        .setTitle(xAxisTitle)
        .setTitleFillStyle(defaultStyle.titleFill)
        .setTitleFont(defaultStyle.titleFont.setSize(14))

    chart.getDefaultAxisY()
        .setScrollStrategy(undefined)
        .setInterval(yInterval[0], yInterval[1])
        .setTitle(yAxisTitle)
        .setTitleFillStyle(defaultStyle.titleFill)
        .setTitleFont(defaultStyle.titleFont.setSize(14))
    return chart
}

const resetHistoryMaxButton = frequencyChart
    .addUIElement(UIElementBuilders.ButtonBox.addStyler(styler => styler
        .setButtonOffFillStyle(defaultStyle.backgroundFill)
        .setButtonOffStrokeStyle(defaultStyle.ui.border)
        .setButtonOnFillStyle(defaultStyle.ui.fill)
    ))
    .setText('Reset Frequency Max')
    .setOrigin(UIOrigins.LeftTop)
    .setPosition({ x: 0, y: 100 })
    .setFont(defaultStyle.titleFont.setSize(14))
    .setTextFillStyle(defaultStyle.titleFill)

const frequencySeries = createSeries(frequencyChart, 'Frequency', '#fff')
const waveformSeries = createSeries(waveformHistoryChart, 'Waveform', '#fff')
const historySeries = createSeries(frequencyChart, 'Frequency Short History', '#ff9511')
const maxFreqSeries = createSeries(frequencyChart, 'Frequency Max', '#ffff11')

waveformHistoryChart
    .getDefaultAxisX()
    .setInterval(0, audioCtx.sampleRate * 10)

setInterval(()=>console.log('s'),1000)

// hack
waveformHistoryChart.getDefaultAxisX().tickStrategy.formatValue = (value: number, range: FormattingRange): string => {
    return (value / audioCtx.sampleRate).toFixed(2)
}

waveformSeries
    .setMaxPointCount(1000 * 1000)
    .setCursorInterpolationEnabled(false)

const d = new Uint8Array(analyzer.fftSize)
const processor = audioCtx.createScriptProcessor(analyzer.fftSize)
processor.onaudioprocess = () => {
    analyzer.getByteTimeDomainData(d)
    timeDomainSeries.clear()
    timeDomainSeries.add(ArrayBufferToPointArray(d, noScaler, freqScaler))
    const waveData = ArrayBufferToPointArray(d, offSetScaler, freqScaler)
    waveformSeries.add(waveData)
    lastTime += waveData.length
}

processor.connect(analyzer)

const srcSelector = document.getElementById('src-selector') as HTMLSelectElement

async function getAudioFileUrl(): Promise<string> {
    return new Promise((resolve) => {
        const el = document.getElementById('audio-file') as HTMLInputElement
        el.addEventListener('change', () => {
            resolve(el.value)
        })
    })
}

let disconnect: () => void
const updateSource = async () => {
    const selectedOptionElement = srcSelector[srcSelector.selectedIndex] as HTMLOptionElement
    src = selectedOptionElement.value as SrcOption
    if (src === SrcOption.file) {
        document.getElementById('audio-input').style.display = 'inline-block'
    } else {
        const ai = document.getElementById('audio-input') as HTMLInputElement
        ai.style.display = 'none'
        ai.value = ''
    }
    if (disconnect) {
        disconnect()
        disconnect = null
    }
    switch (src) {
        case SrcOption.mic:
            disconnect = await listenMic()
            break
        case SrcOption.file:
            disconnect = await listenToFile(await getAudioFileUrl())
            break
        case SrcOption.truck:
            disconnect = await listenToFile(truckSrcUrl)
            break
        case SrcOption.f500_1000_1000:
            disconnect = await listenToFile(f500_1000_1000_url)
            break
    }
}
srcSelector.addEventListener('change', updateSource)
updateSource()
const listenElement = document.getElementById('listen') as HTMLInputElement

listenElement.addEventListener('change', () => {
    listen = listenElement.checked

    if (listen) {
        analyzer.connect(audioCtx.destination)
    } else {
        analyzer.disconnect(audioCtx.destination)
    }
})

async function listenMic(): Promise<() => void> {
    return mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            const src = audioCtx.createMediaStreamSource(stream)
            src.connect(analyzer)
            return src.disconnect.bind(src, analyzer)
        })
}

async function listenToFile(url): Promise<() => void> {
    return fetch(url)
        .then(d => d.arrayBuffer())
        .then(d => audioCtx.decodeAudioData(d))
        .then(d => {
            const src = audioCtx.createBufferSource()
            src.buffer = d
            src.connect(analyzer)
            src.start(0)
            src.loop = true
            return () => {
                src.loop = false
                src.stop()
                src.disconnect(analyzer)
            }
        })
}

timeDomainChart.getDefaultAxisX().setInterval(0, analyzer.fftSize)
frequencyChart.getDefaultAxisX().setInterval(0, audioCtx.sampleRate / analyzer.fftSize * analyzer.frequencyBinCount)
frequencyChart.getDefaultAxisY().setInterval(analyzer.minDecibels, analyzer.maxDecibels)

resetHistoryMaxButton.onMouseClick(() => {
    for (let i = 0; i < frequencyMaxHistoryData.byteLength; i++) {
        frequencyMaxHistoryData[i] = 0
    }
    maxFreqSeries.clear()
    maxFreqSeries.add(ArrayBufferToPointArray(frequencyMaxHistoryData))
})

const scaleToRange = (val: number, origRange: [number, number], newRange: [number, number]): number =>
    (val - origRange[0]) * (newRange[1] - newRange[0]) / (origRange[1] - origRange[0]) + newRange[0]


const dbScaler = (n: number): number => scaleToRange(n, [0, 256], [analyzer.minDecibels, analyzer.maxDecibels])

const freqScaler = (n: number): number => scaleToRange(n, [0, 256], [-1, 1])

const noScaler = (n) => n

const offSetScaler = (n) => n + lastTime

const multiplierScaler = (multiplier) => (n) => n * multiplier

let lastUpdate: number = 0
let delta: number
let lastTime = 0
function update(ts: number) {
    delta = (ts - lastUpdate)
    lastUpdate = ts
    analyzer.getByteTimeDomainData(timeDomainData)
    analyzer.getByteFrequencyData(frequencyData)
    frequencySeries.clear()
    frequencySeries.add(ArrayBufferToPointArray(frequencyData, multiplierScaler(audioCtx.sampleRate / analyzer.fftSize), dbScaler))
    for (let i = 0; i < frequencyHistoryData.length; i++) {
        frequencyHistoryData[i].y = Math.max(Math.max(frequencyData[i], frequencyHistoryData[i].y - 25 / 1000 * delta), 0)
        maxFreqTemp = Math.max(Math.max(frequencyData[i], frequencyMaxHistoryData[i]), 0)
        if (maxFreqTemp > frequencyMaxHistoryData[i]) {
            maxFreqHistChanged = true
            frequencyMaxHistoryData[i] = maxFreqTemp
        }
    }
    historySeries.clear()
    historySeries.add(frequencyHistoryData.map((p, i) => ({ x: p.x * audioCtx.sampleRate / analyzer.fftSize, y: dbScaler(p.y) })))
    if (maxFreqHistChanged) {
        maxFreqSeries.clear()
        maxFreqSeries.add(ArrayBufferToPointArray(frequencyMaxHistoryData, multiplierScaler(audioCtx.sampleRate / analyzer.fftSize), dbScaler))
        maxFreqHistChanged = false
    }
    window.requestAnimationFrame(update)
}

window.requestAnimationFrame(update)

