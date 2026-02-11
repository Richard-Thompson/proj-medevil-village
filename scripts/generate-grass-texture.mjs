/**
 * Generate grass blade texture with alpha channel
 * Run with: node scripts/generate-grass-texture.mjs
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const WIDTH = 8192;
const HEIGHT = 8192;
const NUM_BLADES = 2; // 2x2 grid of blade variations

function drawGrassBlade(ctx, x, y, width, height, variation = 0) {
  ctx.save();
  ctx.translate(x + width / 2, y + height);
  
  // Grass blade colors (dark to light gradient)
  const gradient = ctx.createLinearGradient(0, 0, 0, -height);
  gradient.addColorStop(0, '#2d5016'); // Dark base
  gradient.addColorStop(0.5, '#4a7c3e'); // Mid
  gradient.addColorStop(1, '#6ab84a'); // Light tip
  
  // Draw blade shape
  ctx.beginPath();
  
  const bladeWidth = width * 0.003;
  const curve = 5 + variation * 3;
  
  // Left edge (with slight curve)
  ctx.moveTo(-bladeWidth / 2, 0);
  ctx.quadraticCurveTo(-bladeWidth / 2 + curve, -height * 0.5, -bladeWidth / 4, -height);
  
  // Tip
  ctx.lineTo(0, -height - 5);
  ctx.lineTo(bladeWidth / 4, -height);
  
  // Right edge
  ctx.quadraticCurveTo(bladeWidth / 2 - curve, -height * 0.5, bladeWidth / 2, 0);
  
  // Base
  ctx.lineTo(-bladeWidth / 2, 0);
  ctx.closePath();
  
  // Fill with gradient
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Add some edge darkening for depth
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Add central vein
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -height);
  ctx.stroke();
  
  ctx.restore();
}

function generateGrassTexture() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // Clear with transparent background
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  
  // Create 2x2 grid of blade variations
  const cellWidth = WIDTH / NUM_BLADES;
  const cellHeight = HEIGHT / NUM_BLADES;
  
  let variationIndex = 0;
  
  for (let row = 0; row < NUM_BLADES; row++) {
    for (let col = 0; col < NUM_BLADES; col++) {
      const x = col * cellWidth;
      const y = row * cellHeight;
      
      // Draw grass blade in this cell
      drawGrassBlade(
        ctx,
        x + cellWidth * 0.2,
        y + cellHeight * 0.1,
        cellWidth * 0.6,
        cellHeight * 0.8,
        variationIndex
      );
      
      variationIndex++;
    }
  }
  
  return canvas;
}

// Generate and save
console.log('Generating grass texture...');
const canvas = generateGrassTexture();

const outputPath = '../public/textures/grass-blade.png';
const fullPath = new URL(outputPath, import.meta.url);

// Create directory if it doesn't exist
mkdirSync(dirname(fileURLToPath(fullPath)), { recursive: true });

// Save as PNG
const buffer = canvas.toBuffer('image/png');
writeFileSync(fileURLToPath(fullPath), buffer);

console.log(`✓ Grass texture saved to: ${outputPath}`);
console.log(`  Size: ${WIDTH}x${HEIGHT}`);
console.log(`  Variations: ${NUM_BLADES * NUM_BLADES}`);
