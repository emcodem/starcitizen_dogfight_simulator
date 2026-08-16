import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ============================================================================================
// UnrealBloomPass with a properly windowed Gaussian per mip.
//
// WHY THIS EXISTS. three.js's own blur kernel (UnrealBloomPass.getSeperableBlurMaterial) is
//
//     w[i] = 0.39894 * exp(-0.5 * i*i / (kernelRadius*kernelRadius)) / kernelRadius,  i = 0 .. kernelRadius-1
//
// so sigma equals kernelRadius while the loop stops at i = kernelRadius-1: the Gaussian is
// TRUNCATED AT 1 SIGMA, where its weight is still exp(-0.5) = 0.61 of peak (measured edge weights
// across the five mips: 0.80, 0.73, 0.69, 0.67, 0.66). That is not a Gaussian, it is a soft BOX —
// and it has two consequences that both show up on screen:
//
//   1. NOT ROUND. A separable kernel with a hard cutoff has SQUARE support: beyond +/-kernelRadius
//      texels the weight is exactly zero, so each mip's contribution ends on an axis-aligned square
//      whose corners reach out sqrt(2) further than its sides. The glow reads as subtly rectangular
//      rather than circular.
//   2. HARD EDGES THAT LOOK LIKE BANDING. The cutoff is a step in the kernel, so it puts a step in
//      the image at each mip's support boundary. With mip texels of 3/6/12/24/48 device px (see
//      BLOOM_MIP0_FRACTION in renderer.ts) and support half-widths of kernelRadius-1 texels, those
//      boundaries land at roughly 6, 24, 72, 192 and 480 device px from a bright source. The 192 px
//      one sits right inside the sun's inner shine, the 480 px one out in the outer shine.
//
// Crucially this is real structure in the float signal, NOT quantization — so the output dither in
// render/ditheredOutputPass.ts cannot touch it. Dither fixes rounding; it cannot smooth a gradient
// that genuinely has a step in it. The two fixes are complementary, and both are needed.
//
// THE FIX is to window the Gaussian where it is actually negligible (3 sigma, weight exp(-4.5) =
// 0.011 of peak) instead of at 1 sigma. Done naively that needs 3x the taps. It is instead free
// here, via two standard tricks:
//
//   - MATCHED SECOND MOMENT. sigma is not taken as kernelRadius but computed as the standard
//     deviation of three.js's own kernel for that kernelRadius (1.36, 2.45, 3.53, 4.62, 5.70
//     texels). The replacement therefore has the SAME spatial width as what shipped, so the halo
//     keeps its current size and the change is purely about shape and smoothness — not a retune of
//     how far the sun's shine reaches.
//   - LINEAR SAMPLING. One bilinear fetch, placed at the weighted centroid of two adjacent texels,
//     returns their correctly-weighted sum. So a kernel spanning R texels costs only ~R/2 taps.
//
// Net: 34 taps total against three.js's 35, for a true 3-sigma Gaussian at identical width.
// ============================================================================================

// Standard deviation of three.js's own (1-sigma-truncated) kernel for a given kernelRadius. Matching
// this is what keeps the halo the same size as before — see the note above.
function matchedSigma(kernelRadius: number): number {
  let num = 0;
  let den = 1; // the i = 0 tap, whose weight is exp(0) = 1
  for (let i = 1; i < kernelRadius; i++) {
    const w = Math.exp(-0.5 * (i * i) / (kernelRadius * kernelRadius));
    num += 2 * w * i * i; // symmetric: +i and -i
    den += 2 * w;
  }
  return Math.sqrt(num / den);
}

// Discrete Gaussian of the given sigma out to 3 sigma, with adjacent texel pairs collapsed into
// single bilinear fetches. Returns pre-normalised weights so the shader needs no running sum:
// weights[0] is the centre tap, weights[i>0] are applied at BOTH +offsets[i] and -offsets[i].
function linearSampledGaussian(sigma: number): { offsets: number[]; weights: number[] } {
  const R = Math.ceil(3 * sigma);
  const w: number[] = [];
  for (let i = 0; i <= R; i++) w.push(Math.exp(-0.5 * (i * i) / (sigma * sigma)));

  const offsets = [0];
  const weights = [w[0]];
  for (let i = 1; i <= R; i += 2) {
    const w1 = w[i];
    const w2 = i + 1 <= R ? w[i + 1] : 0;
    const sum = w1 + w2;
    weights.push(sum);
    // bilinear fetch at the pair's weighted centroid returns w1*texel(i) + w2*texel(i+1), scaled
    offsets.push((i * w1 + (i + 1) * w2) / sum);
  }

  let total = weights[0];
  for (let i = 1; i < weights.length; i++) total += 2 * weights[i];
  return { offsets, weights: weights.map((v) => v / total) };
}

// Replacement for three's LuminosityHighPassShader fragment shader, identical except that it
// discards non-finite input texels. See the NaN note in the constructor below.
//
// GLSL ES 1.00 (what three compiles ShaderMaterial to by default, even on WebGL2) has no isnan(),
// and NaN poisons every arithmetic operation it touches, so it cannot be filtered after the fact.
// The portable test is a comparison: IEEE-754 says EVERY comparison involving NaN is false, so
// `abs(x) < HUGE` is false for NaN and the ternary falls through to 0.0. Testing abs() against a
// finite bound catches +/-Inf in the same expression. (Written per-component rather than with a
// bvec3 mix(), which is GLSL ES 3.00+ only.)
const SANITIZED_HIGH_PASS_FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;

  varying vec2 vUv;

  float finiteOrZero(float x) {
    return (abs(x) < 1e12) ? x : 0.0;
  }

  void main() {
    vec4 raw = texture2D(tDiffuse, vUv);
    vec3 texel = vec3(finiteOrZero(raw.r), finiteOrZero(raw.g), finiteOrZero(raw.b));

    float v = luminance(texel); // three prepends ShaderChunk.common to every fragment shader

    vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);

    float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);

    gl_FragColor = mix(outputColor, vec4(texel, finiteOrZero(raw.a)), alpha);
  }`;

export class SmoothBloomPass extends UnrealBloomPass {
  constructor(...args: ConstructorParameters<typeof UnrealBloomPass>) {
    super(...args);

    // NaN BLAST WALL. A Gaussian blur is a weighted sum, so a single NaN texel anywhere in the
    // scene target makes every tap that reaches it NaN — including with weight 0, since NaN * 0 is
    // NaN — and the mip chain then carries it to the whole image, compositing back as a fully black
    // frame. That is not hypothetical: a laser bolt's nose vertex used to bake alpha = NaN into its
    // colour attribute and blacked out the entire screen whenever anyone was shooting at you (see
    // BLOOM_BLACKOUT_FINDINGS.md, and the fix at the source in render/meshes.ts).
    //
    // The high-pass is the right chokepoint: everything the blur ever reads comes out of
    // renderTargetBright, which is this material's output. Filtering here means no NaN can enter the
    // mip pyramid no matter what the scene did, so the worst a future stray NaN can cost is the
    // handful of pixels it actually covers instead of the whole frame. Cheap (three ternaries per
    // texel, at mip-0 resolution) and visually a no-op on finite input.
    //
    // Patching the parent's material rather than overriding a method because UnrealBloomPass builds
    // materialHighPassFilter inline in its constructor with no seam to hook.
    this.materialHighPassFilter.fragmentShader = SANITIZED_HIGH_PASS_FRAGMENT;
    this.materialHighPassFilter.needsUpdate = true;
  }

  // Overrides the parent's kernel builder. Called from UnrealBloomPass's constructor (during our
  // super() call), so this must not touch instance state — everything it needs comes from the
  // module-level helpers above. The uniform contract the parent relies on is preserved exactly:
  // `colorTexture` and `direction` are set per blur pass in its render(), `invSize` in its setSize().
  //
  // `kernelRadius` is optional only to satisfy three's type declaration, which types this method as
  // taking no arguments even though UnrealBloomPass's own constructor calls it as
  // getSeperableBlurMaterial(kernelSizeArray[i]). The parameter is real; the .d.ts is wrong. The
  // fallback is the first entry of that stock array, so a hypothetical no-arg call still yields a
  // valid (merely tightest) kernel rather than a NaN one.
  override getSeperableBlurMaterial(kernelRadius?: number): THREE.ShaderMaterial {
    const { offsets, weights } = linearSampledGaussian(matchedSigma(kernelRadius ?? 3));

    return new THREE.ShaderMaterial({
      defines: { TAPS: offsets.length },
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: new THREE.Vector2(0.5, 0.5) },
        direction: { value: new THREE.Vector2(0.5, 0.5) },
        gOffsets: { value: offsets },
        gWeights: { value: weights }
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // Loop-indexed reads of a uniform array are a constant-index-expression under GLSL ES 1.00,
      // which is why three's own kernel can do the same thing.
      fragmentShader: /* glsl */`
        #include <common>
        varying vec2 vUv;
        uniform sampler2D colorTexture;
        uniform vec2 invSize;
        uniform vec2 direction;
        uniform float gOffsets[TAPS];
        uniform float gWeights[TAPS];

        void main() {
          vec3 sum = texture2D(colorTexture, vUv).rgb * gWeights[0];
          for (int i = 1; i < TAPS; i++) {
            vec2 o = direction * invSize * gOffsets[i];
            sum += (texture2D(colorTexture, vUv + o).rgb + texture2D(colorTexture, vUv - o).rgb) * gWeights[i];
          }
          gl_FragColor = vec4(sum, 1.0); // weights are pre-normalised
        }`
    });
  }
}
