// Light-mode globe: a dotted, colour-mapped Three.js globe (r133, ESM) that
// crossfades in when the page returns to light mode and takes the place of the
// dark dataarts globe. Adapted from Ksenia Kondrashova's "3D Globe with location
// pointer" (codepen.io/ksenia-k/pen/NWERpmb) — stripped to the rotating globe
// (no click pointer/popup) since here it's a non-interactive background layer.
//
// It deliberately mirrors the dark globe: a centered square sized to
// 0.65·min(viewport) (earth radius ~0.295·height, same as the dark globe), so
// the swap keeps the exact dimensions/placement. The dock transform is shared
// via the inherited --dock* custom properties on :root.
import * as THREE from "https://esm.sh/three@0.133.1/build/three.module";
import { OrbitControls } from "https://esm.sh/three@0.133.1/examples/jsm/controls/OrbitControls";

const TEX_URL = "https://ksenia-k.com/img/earth-map-colored.png";
const root = document.getElementById("xpGlobeLight");

if (root) {
  const containerEl = root.querySelector(".globe-wrapper");
  const canvas3D = root.querySelector("#globe-3d");
  const docEl = document.documentElement;

  let renderer, scene, camera, controls, mapMaterial;

  const initScene = () => {
    renderer = new THREE.WebGLRenderer({ canvas: canvas3D, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0, 3);
    camera.position.z = 1.1;

    controls = new OrbitControls(camera, canvas3D);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.4 * Math.PI;
    controls.maxPolarAngle = 0.4 * Math.PI;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;

    new THREE.TextureLoader().load(TEX_URL, (tex) => {
      tex.repeat.set(1, 1);
      createGlobe(tex);
      updateSize();
      render();
    });
  };

  const createGlobe = (earthTexture) => {
    const geometry = new THREE.IcosahedronGeometry(1, 22);
    mapMaterial = new THREE.ShaderMaterial({
      vertexShader: document.getElementById("vertex-shader-map").textContent,
      fragmentShader: document.getElementById("fragment-shader-map").textContent,
      uniforms: {
        u_map_tex: { type: "t", value: earthTexture },
        u_dot_size: { type: "f", value: 0 },
        u_pointer: { type: "v3", value: new THREE.Vector3(0, 0, 1) },
        u_time_since_click: { value: 0 },
      },
      alphaTest: false,
      transparent: true,
    });
    scene.add(new THREE.Points(geometry, mapMaterial));
  };

  const updateSize = () => {
    const minSide = 0.65 * Math.min(window.innerWidth, window.innerHeight);
    containerEl.style.width = minSide + "px";
    containerEl.style.height = minSide + "px";
    if (renderer) renderer.setSize(minSide, minSide);
    if (mapMaterial) mapMaterial.uniforms.u_dot_size.value = 0.04 * minSide;
  };

  const render = () => {
    requestAnimationFrame(render);
    // Only render while active (in the experience→contact zone) AND in light
    // mode — in dark mode the dark globe is showing, so stay off the GPU.
    if (root.getAttribute("data-active") !== "1") return;
    if (docEl.classList.contains("is-dark")) return;
    controls.update();
    renderer.render(scene, camera);
  };

  initScene();
  window.addEventListener("resize", updateSize);
}
