import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';

export const particles = (function() {

  const _VS = `
attribute float size;
varying vec3 vColor;

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_PointSize = size * ( 300.0 / -mvPosition.z );
  gl_Position = projectionMatrix * mvPosition;
}
`;

  const _PS = `
uniform sampler2D pointTexture;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor * 4.0, 1.0);
  gl_FragColor = gl_FragColor * texture2D( pointTexture, gl_PointCoord );
}
`;

  return {
      ParticleSystem: class {
        constructor(game, params) {
          this._Initialize(game, params);
        }

        _Initialize(game, params) {
          const uniforms = {
          pointTexture: {
                  value: new THREE.TextureLoader().load(params.texture)
              }
          };
          this._material = new THREE.ShaderMaterial( {
              uniforms: uniforms,
              vertexShader: _VS,
              fragmentShader: _PS,

              blending: THREE.AdditiveBlending,
              depthTest: true,
              depthWrite: false,
              transparent: true,
              vertexColors: true
          } );

          this._geometry = new THREE.BufferGeometry();

          this._particleSystem = new THREE.Points(
              this._geometry, this._material);

          game._graphics._scene.add(this._particleSystem);

          this._liveParticles = [];
        }

        CreateParticle() {
          const p = {
            Position: new THREE.Vector3(0, 0, 0),
            Colour: new THREE.Color(),
            Size: 1,
            Alive: true,
          };
          this._liveParticles.push(p);
          return p;
        }

        Update() {
          this._liveParticles = this._liveParticles.filter(p => {
            return p.Alive;
          });

          const positions = [];
          const colors = [];
          const sizes = [];

          for (const p of this._liveParticles) {
            positions.push(p.Position.x, p.Position.y, p.Position.z);
            colors.push(p.Colour.r, p.Colour.g, p.Colour.b);
            sizes.push(p.Size);
          }

          this._geometry.setAttribute(
              'position', new THREE.Float32BufferAttribute(positions, 3));
          this._geometry.setAttribute(
              'color', new THREE.Float32BufferAttribute(colors, 3));
          this._geometry.setAttribute(
              'size', new THREE.Float32BufferAttribute(sizes, 1).setUsage(
                  THREE.DynamicDrawUsage));

          this._geometry.attributes.position.needsUpdate = true;
          this._geometry.attributes.color.needsUpdate = true;
          this._geometry.attributes.size.needsUpdate = true;
        }
      }
  };
})();
