const { createCanvas } = require('@napi-rs/canvas')
const fs = require('fs')

const SIZE = 512
const canvas = createCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d')

// Background - rounded square with gradient
const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE)
grad.addColorStop(0, '#1e2d52')
grad.addColorStop(1, '#111827')
ctx.fillStyle = grad
ctx.beginPath()
ctx.roundRect(0, 0, SIZE, SIZE, 80)
ctx.fill()

// Book shape
const bx = 120, by = 140, bw = 272, bh = 200
ctx.fillStyle = '#f3f4f6'
ctx.beginPath()
ctx.roundRect(bx, by, bw, bh, 12)
ctx.fill()

// Book spine
ctx.fillStyle = '#2563eb'
ctx.beginPath()
ctx.roundRect(bx, by, 16, bh, [12, 0, 0, 12])
ctx.fill()

// Book lines (text)
ctx.fillStyle = '#9ca3af'
for (let i = 0; i < 4; i++) {
  ctx.beginPath()
  ctx.roundRect(bx + 40, by + 30 + i * 35, bw - 70, 8, 4)
  ctx.fill()
}

// Speech bubble (question mark)
const sx = 280, sy = 80, sr = 60
ctx.fillStyle = '#3b82f6'
ctx.beginPath()
ctx.arc(sx, sy, sr, 0, Math.PI * 2)
ctx.fill()

// Bubble tail
ctx.beginPath()
ctx.moveTo(sx - 20, sy + sr - 5)
ctx.lineTo(sx - 50, sy + sr + 30)
ctx.lineTo(sx + 5, sy + sr + 5)
ctx.fill()

// Question mark
ctx.fillStyle = '#ffffff'
ctx.font = 'bold 64px sans-serif'
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'
ctx.fillText('?', sx, sy + 2)

// Save as PNG
const png = canvas.toBuffer('image/png')
fs.writeFileSync('build/icon.png', png)

// Also save 256 version for smaller sizes
const c2 = createCanvas(256, 256)
const ctx2 = c2.getContext('2d')
ctx2.drawImage(canvas, 0, 0, 256, 256)
fs.writeFileSync('build/icon-256.png', c2.toBuffer('image/png'))

console.log('Icon generated: build/icon.png (512x512), build/icon-256.png (256x256)')
