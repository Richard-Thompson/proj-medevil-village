/**
 * Grass vertex shader with wind animation
 * Optimized for instanced rendering
 */

export const grassVertexShader = `
uniform float uTime;
uniform float uWindSpeed;
uniform float uWindStrength;
uniform vec2 uWindDirection;

varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;

// Simple noise function for wind variation
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  
  // Instance position and rotation from matrix
  vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  
  // Wind animation
  vec3 pos = position;
  
  // Only affect vertices above ground (based on Y/Z depending on axis)
  float heightFactor = pos.z; // 0 at base, 1 at top
  vHeight = heightFactor;
  
  if (heightFactor > 0.01) {
    // Per-instance wind phase based on position
    float windPhase = hash(instancePos.xz) * 6.28318;
    
    // Wind wave
    float windTime = uTime * uWindSpeed + windPhase;
    vec2 windOffset = uWindDirection * sin(windTime) * uWindStrength;
    
    // Apply wind with quadratic falloff (more bend at top)
    float bendAmount = heightFactor * heightFactor;
    pos.x += windOffset.x * bendAmount;
    pos.y += windOffset.y * bendAmount;
    
    // Secondary turbulence
    float turbulence = hash(instancePos.xz + vec2(uTime * 0.5)) - 0.5;
    pos.xy += turbulence * 0.02 * bendAmount * uWindStrength;
  }
  
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Grass fragment shader with alpha clipping
 */
export const grassFragmentShader = `
uniform vec3 uGrassColorBase;
uniform vec3 uGrassColorTip;
uniform float uAlphaTest;
uniform sampler2D uTexture;
uniform bool uUseTexture;

varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;

void main() {
  vec4 texColor = vec4(1.0);
  
  if (uUseTexture) {
    texColor = texture2D(uTexture, vUv);
    
    // Alpha test for sharp edges
    if (texColor.a < uAlphaTest) {
      discard;
    }
  }
  
  // Gradient from base to tip
  vec3 grassColor = mix(uGrassColorBase, uGrassColorTip, vHeight);
  
  // Simple lighting
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
  float diff = max(dot(vNormal, lightDir), 0.0) * 0.6 + 0.4;
  
  // Ambient occlusion at base
  float ao = mix(0.7, 1.0, vHeight);
  
  vec3 finalColor = grassColor * texColor.rgb * diff * ao;
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
