import gsap from "https://cdn.skypack.dev/gsap";

// ---------------------------------------------------------
// 1) SHADER CODE (GLSL 1.0, same style as your working version)
// ---------------------------------------------------------
const vertexShader = `
  varying vec2 vUv;
  varying float vDistortion;

  // Uniforms we can animate (time, frequency, amplitude)
  uniform float uTime;
  uniform float uFrequency;
  uniform float uAmplitude;

  // 3D simplex noise helpers
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  vec4 permute(vec4 x) {
    return mod289(((x*34.0)+1.0)*x);
  }
  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  // 3D simplex noise
  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(
      permute(
        permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0)
      )
      + i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0*floor(p*ns.z*ns.z);

    vec4 x_ = floor(j*ns.z);
    vec4 y_ = floor(j - 7.0*x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    vec4 norm = taylorInvSqrt(vec4(
      dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)
    ));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(
      0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)),
      0.0
    );
    m = m*m;
    return 42.0 * dot(
      m*m,
      vec4(
        dot(p0,x0),
        dot(p1,x1),
        dot(p2,x2),
        dot(p3,x3)
      )
    );
  }

  void main() {
    // Pass uv to fragment
    vUv = uv;

    // Get the base position
    vec3 pos = position;

    // Scale the frequency for some variation
    float spikeFrequency = uFrequency * 1.5;

    // 1st noise
    float noise1 = snoise(vec3(
      pos.x * spikeFrequency + uTime,
      pos.y * spikeFrequency + uTime,
      pos.z * spikeFrequency + uTime
    )) * uAmplitude;

    // 2nd noise with different scale/time
    float noise2 = snoise(vec3(
      pos.x * (spikeFrequency * 1.5) + uTime * 0.5,
      pos.y * (spikeFrequency * 1.5) + uTime * 0.5,
      pos.z * (spikeFrequency * 1.5) + uTime * 0.5
    )) * (uAmplitude * 0.2);

    float finalNoise = noise1 + noise2;

    // Distort along normal
    vec3 newPos = pos + normal * finalNoise;

    // Pass the distortion to fragment
    vDistortion = finalNoise;

    // Output final position
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
  }
`;

const fragmentShader = `
  // We'll mix two colors based on vDistortion
  uniform vec3 uLowColor;
  uniform vec3 uHighColor;
  varying float vDistortion;

  void main() {
    // Remap vDistortion (-1..1) to (0..1) for mix
    vec3 color = mix(uLowColor, uHighColor, vDistortion * 0.5 + 0.5);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ------------------------------------------------------
// 2) BLOB ANIMATION CLASS
// ------------------------------------------------------
class BlobAnimation {
  constructor() {
    // We'll define two "states":
    //  - firstState => more chaotic
    //  - secondState => calmer
    this.initialState = {
      sphereRadius: 5,
      sphereSegments: 200,

      // The "chaotic" state
      firstState: {
        frequency: 0.25,
        amplitude: 1.2,
        lowColor: "#E2B5FF",
        highColor: "#9E30F7",
      },
      // The "calm" state
      secondState: {
        frequency: 0.28,
        amplitude: 0.35,
        lowColor: "#E5E544",
        highColor: "#00B98E",
      },
    };

    // Grab the container
    this.container = document.getElementById("blob-container");
    if (!this.container) {
      console.error("No #blob-container found in the HTML!");
      return;
    }

    // Setup scene, camera, renderer
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    // this.camera.position.z = 10;
    this.camera.position.set(-2, 0, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    // Create the blob starting from the "chaotic" state (firstState)
    this.createBlob();

    this.createRaycaster();

    // Setup the GSAP scroll animation
    this.setupGSAPAnimation();

    this.handleMousemove();

    // Resize handling
    this.addEventListeners();

    // Start the render loop
    this.animate();
  }

  createBlob() {
    if (!this.scene) return;

    // The default is "chaotic" => firstState
    const chaotic = this.initialState.firstState;

    // Create a ShaderMaterial with the chaotic state
    this.blobMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFrequency: { value: chaotic.frequency },
        uAmplitude: { value: chaotic.amplitude },
        uLowColor: { value: new THREE.Color(chaotic.lowColor) },
        uHighColor: { value: new THREE.Color(chaotic.highColor) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
    });

    // Create sphere geometry
    const geometry = new THREE.SphereGeometry(this.initialState.sphereRadius, this.initialState.sphereSegments, this.initialState.sphereSegments);

    // Mesh it
    this.blob = new THREE.Mesh(geometry, this.blobMaterial);
    this.blob.position.x = 3; // Move the blob a bit to the left
    this.scene.add(this.blob);
  }

  createRaycaster() {
    this.raycaster = new THREE.Raycaster();
  }

  // We'll animate from chaotic => calm on scroll
  setupGSAPAnimation() {
    // const calm = this.initialState.secondState;
    // const chaotic = this.initialState.firstState;
    // this.blobMaterial.addEventListener("mouseenter", () => {
    //   gsap.to(this.blobMaterial.uniforms.uFrequency, {
    //     value: calm.frequency,
    //     duration: 2,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uAmplitude, {
    //     value: calm.amplitude,
    //     duration: 2,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uLowColor.value, {
    //     r: new THREE.Color(calm.lowColor).r,
    //     g: new THREE.Color(calm.lowColor).g,
    //     b: new THREE.Color(calm.lowColor).b,
    //     duration: 1,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uHighColor.value, {
    //     r: new THREE.Color(calm.highColor).r,
    //     g: new THREE.Color(calm.highColor).g,
    //     b: new THREE.Color(calm.highColor).b,
    //     duration: 0.8,
    //     ease: "power2.inOut",
    //   });
    // });
    // this.blobMaterial.addEventListener("mouseleave", () => {
    //   gsap.to(this.blobMaterial.uniforms.uFrequency, {
    //     value: chaotic.frequency,
    //     duration: 2,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uAmplitude, {
    //     value: chaotic.amplitude,
    //     duration: 2,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uLowColor.value, {
    //     r: new THREE.Color(chaotic.lowColor).r,
    //     g: new THREE.Color(chaotic.lowColor).g,
    //     b: new THREE.Color(chaotic.lowColor).b,
    //     duration: 1,
    //     ease: "power2.inOut",
    //   });
    //   gsap.to(this.blobMaterial.uniforms.uHighColor.value, {
    //     r: new THREE.Color(chaotic.highColor).r,
    //     g: new THREE.Color(chaotic.highColor).g,
    //     b: new THREE.Color(chaotic.highColor).b,
    //     duration: 0.8,
    //     ease: "power2.inOut",
    //   });
    // });
  }

  transitionToCalmState() {
    const calm = this.initialState.secondState;

    gsap.to(this.blobMaterial.uniforms.uFrequency, {
      value: calm.frequency,
      duration: 2,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uAmplitude, {
      value: calm.amplitude,
      duration: 2,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uLowColor.value, {
      r: new THREE.Color(calm.lowColor).r,
      g: new THREE.Color(calm.lowColor).g,
      b: new THREE.Color(calm.lowColor).b,
      duration: 1,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uHighColor.value, {
      r: new THREE.Color(calm.highColor).r,
      g: new THREE.Color(calm.highColor).g,
      b: new THREE.Color(calm.highColor).b,
      duration: 0.8,
      ease: "power2.inOut",
    });
  }

  transitionToChaoticState() {
    const chaotic = this.initialState.firstState;

    gsap.to(this.blobMaterial.uniforms.uFrequency, {
      value: chaotic.frequency,
      duration: 2,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uAmplitude, {
      value: chaotic.amplitude,
      duration: 2,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uLowColor.value, {
      r: new THREE.Color(chaotic.lowColor).r,
      g: new THREE.Color(chaotic.lowColor).g,
      b: new THREE.Color(chaotic.lowColor).b,
      duration: 1,
      ease: "power2.inOut",
    });

    gsap.to(this.blobMaterial.uniforms.uHighColor.value, {
      r: new THREE.Color(chaotic.highColor).r,
      g: new THREE.Color(chaotic.highColor).g,
      b: new THREE.Color(chaotic.highColor).b,
      duration: 0.8,
      ease: "power2.inOut",
    });
  }

  handleMousemove() {
    this.mouse = new THREE.Vector2(9999, 9999); // Start far outside the screen

    window.addEventListener("mousemove", (event) => {
      this.mouse.x = (event.clientX / this.container.clientWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / this.container.clientHeight) * 2 + 1;
    });
  }

  handleResize = () => {
    if (!this.camera || !this.renderer || !this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  addEventListeners() {
    window.addEventListener("resize", this.handleResize);
  }

  // Render loop
  animate = () => {
    requestAnimationFrame(this.animate);
    // Ensure geometry exists
    if (this.blobMaterial) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      this.intersects = this.raycaster.intersectObject(this.blob);

      if (this.intersects.length > 0) {
        if (!this.isHovered) {
          // Only trigger if it's a new hover
          this.isHovered = true;
          this.transitionToCalmState();
        }
      } else {
        if (this.isHovered) {
          // Only trigger when leaving
          this.isHovered = false;
          this.transitionToChaoticState();
        }
      }

      // Increase time for the noise
      this.blobMaterial.uniforms.uTime.value += 0.001;
    }

    this.renderer.render(this.scene, this.camera);
  };
}
document.addEventListener("DOMContentLoaded", () => {
  new BlobAnimation();
});
