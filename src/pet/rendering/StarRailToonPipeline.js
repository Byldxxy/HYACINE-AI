/**
 * 面向透明桌宠的动漫角色着色。参考星穹铁道的亮底色、分区阴影与细描边，
 * 不依赖游戏私有贴图或 shader；没有脸部 SDF 时使用头部坐标系的解析近似。
 * 保留 MMD 材质实例/贴图/opacity，避免破坏 PMX 材质 morph 和透明配件。
 */
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';

export function materialRegion(name = '') {
    if (/目|眼|瞳|眉|睫|eye|lash|brow|齿|歯|teeth|biaoq/i.test(name)) return 'eye';
    if (/颜|顔|face/i.test(name)) return 'face';
    if (/髪|发|髮|hair/i.test(name)) return 'hair';
    if (/肌|肤|skin|^口$|^舌$|指甲/i.test(name)) return 'skin';
    if (/金属|metal|gold/i.test(name)) return 'metal';
    return 'cloth';
}

// RGB 为线性空间的乘色系数；亮面始终以原始 albedo 为基准，不乘 Lambert 的 1/π。
const REGIONS = {
    cloth: { shadow: [0.60, 0.57, 0.70], rim: 0.045, specular: 0, width: 0.0011, outline: '#68515f' },
    hair: { shadow: [0.72, 0.48, 0.59], rim: 0.07, specular: 0.12, width: 0.0010, outline: '#925b70' },
    face: { shadow: [0.93, 0.77, 0.78], rim: 0, specular: 0, width: 0.00055, outline: '#b88080' },
    skin: { shadow: [0.85, 0.64, 0.66], rim: 0.018, specular: 0, width: 0.00065, outline: '#af797b' },
    eye: { shadow: [1, 1, 1], rim: 0, specular: 0, width: 0, outline: '#68515f' },
    metal: { shadow: [0.58, 0.49, 0.40], rim: 0.065, specular: 0.42, width: 0.00085, outline: '#7f624a' },
};

export const characterFragmentShader = /* glsl */`
#define TOON
uniform vec3 diffuse;
uniform float opacity;
uniform vec3 petLight;
uniform vec3 petFaceForward;
uniform vec3 petFaceRight;
uniform vec3 petShadow;
uniform float petFace;
uniform float petEye;
uniform float petRim;
uniform float petSpecular;
varying vec3 vViewPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <normal_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
    vec4 diffuseColor = vec4(diffuse, opacity);
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    #include <map_fragment>
    #include <alphamap_fragment>
    #include <alphatest_fragment>
    #include <normal_fragment_begin>
    vec3 N = normalize(normal);
    vec3 L = normalize(petLight);
    vec3 V = normalize(vViewPosition);
    float ndl = dot(N, L);
    // 脸部使用头部方向与左右侧向量划分亮暗，减少鼻、嘴三角面造成的脏黑阴影。
    float faceSide = dot(N, normalize(petFaceRight));
    float faceLight = dot(L, normalize(petFaceForward))
        + faceSide * dot(L, normalize(petFaceRight)) * 0.65;
    ndl = mix(ndl, faceLight, petFace);
    float feather = max(fwidth(ndl) * 1.5, 0.025);
    float lit = smoothstep(0.12 - feather, 0.12 + feather, ndl);
    lit = mix(lit, 1.0, petEye);
    vec3 albedo = clamp(diffuseColor.rgb, 0.0, 1.0);
    vec3 outgoingLight = albedo * mix(petShadow, vec3(1.0), lit);
    // 有限的色块高光，不叠加旧 matcap，以免白衣过曝、头发塑料化。
    float halfDot = max(dot(N, normalize(L + V)), 0.0);
    float highlight = smoothstep(0.94, 0.97, halfDot) * petSpecular * lit;
    outgoingLight = mix(outgoingLight, mix(albedo, vec3(1.0, 0.94, 0.88), 0.6), highlight);
    float rim = smoothstep(0.60, 0.90, 1.0 - max(dot(N, V), 0.0));
    rim *= smoothstep(-0.15, 0.6, dot(N, L)) * petRim;
    outgoingLight = mix(outgoingLight, vec3(1.0, 0.91, 0.94), rim);
    #include <opaque_fragment>
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
}
`;

export class StarRailToonPipeline {
    constructor(renderer) {
        this.renderer = renderer;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        this.lightWorld = new THREE.Vector3(-0.35, 0.55, 0.76).normalize();
        this.uniforms = {
            petLight: { value: this.lightWorld.clone() },
            petFaceForward: { value: new THREE.Vector3(0, 0, 1) },
            petFaceRight: { value: new THREE.Vector3(1, 0, 0) },
        };
        this.rotation = new THREE.Quaternion();
        this.materials = [];
        this.outline = new OutlineEffect(renderer, { defaultThickness: 0.001, defaultAlpha: 1 });
    }

    configure(mesh) {
        this.mesh = mesh;
        this.head = mesh.skeleton?.bones.find(bone => ['頭', 'Head', 'head'].includes(bone.name));
        const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials.filter(Boolean)) {
            if (!material.isMMDToonMaterial) continue;
            const region = materialRegion(material.name);
            const profile = REGIONS[region];
            material.vertexShader = THREE.ShaderLib.toon.vertexShader;
            material.fragmentShader = characterFragmentShader;
            material.onBeforeCompile = () => {};
            material.defines = {};
            material.lights = false;
            material.fog = false;
            material.toneMapped = false;
            // 标准 alpha 合成，避免旧 MMD 自定义 SrcAlpha/DstAlpha 将半透明边缘重复压暗。
            material.blending = THREE.NormalBlending;
            material.alphaToCoverage = false;
            Object.assign(material.uniforms, this.uniforms, {
                petShadow: { value: new THREE.Vector3(...profile.shadow) },
                petFace: { value: region === 'face' ? 1 : 0 },
                petEye: { value: region === 'eye' ? 1 : 0 },
                petRim: { value: profile.rim },
                petSpecular: { value: profile.specular },
            });
            if (material.map) {
                material.map.colorSpace = THREE.SRGBColorSpace;
                material.map.anisotropy = anisotropy;
            }
            const oldOutline = material.userData.outlineParameters;
            material.userData.outlineParameters = {
                thickness: profile.width,
                color: new THREE.Color(profile.outline).toArray(),
                alpha: 1,
                // 透明覆层、眼白、虹膜不膨胀，避免黑眼圈和覆盖瞳孔。
                visible: Boolean(oldOutline?.visible) && profile.width > 0 && material.opacity >= 0.99,
            };
            material.userData.petRegion = region;
            material.needsUpdate = true;
            this.materials.push(material);
        }
    }

    render(scene, camera) {
        camera.updateMatrixWorld();
        this.uniforms.petLight.value.copy(this.lightWorld).transformDirection(camera.matrixWorldInverse);
        if (this.mesh) {
            this.mesh.updateMatrixWorld(true);
            (this.head || this.mesh).getWorldQuaternion(this.rotation);
            this.uniforms.petFaceForward.value.set(0, 0, 1).applyQuaternion(this.rotation).transformDirection(camera.matrixWorldInverse);
            this.uniforms.petFaceRight.value.set(1, 0, 0).applyQuaternion(this.rotation).transformDirection(camera.matrixWorldInverse);
        }
        this.outline.render(scene, camera);
    }

    snapshot() {
        return { name: 'star-rail-inspired-toon', materials: this.materials.map(m => ({ name: m.name, region: m.userData.petRegion })) };
    }
}
