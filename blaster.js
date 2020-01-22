import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';

export const blaster = (function() {

  const _VS = `
varying vec2 v_UV;
varying vec3 vColor;

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  v_UV = uv;
}
`;

  const _PS = `
uniform sampler2D texture;
varying vec2 v_UV;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, 1.0) * texture2D(texture, v_UV);
}
`;

  return {
      BlasterSystem: class {
        constructor(game, params) {
          this._Initialize(game, params);
        }

        _Initialize(game, params) {
          const uniforms = {
          texture: {
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

          this._particleSystem = new THREE.Mesh(
              this._geometry, this._material);

          game._graphics._scene.add(this._particleSystem);

          this._game = game;

          this._liveParticles = [];
        }

        CreateParticle() {
          const p = {
            Start: new THREE.Vector3(0, 0, 0),
            End: new THREE.Vector3(0, 0, 0),
            Colour: new THREE.Color(),
            Size: 1,
            Alive: true,
          };
          this._liveParticles.push(p);
          return p;
        }

        Update(timeInSeconds) {
          for (const p of this._liveParticles) {
            p.Life -= timeInSeconds;
            p.End.add(p.Velocity.clone().multiplyScalar(timeInSeconds));

            const segment = p.End.clone().sub(p.Start);
            if (segment.length() > p.Length) {
              const dir = p.Velocity.clone().normalize();
              p.Start = p.End.clone().sub(dir.multiplyScalar(p.Length));
            }
          }

          this._liveParticles = this._liveParticles.filter(p => {
            return p.Alive;
          });

          this._GenerateBuffers();
        }

        _GenerateBuffers() {
          const indices = [];
          const positions = [];
          const colors = [];
          const uvs = [];

          const square = [0, 1, 2, 2, 3, 0];
          let indexBase = 0;

          for (const p of this._liveParticles) {
            indices.push(...square.map(i => i + indexBase));
            indexBase += 4;

            const v1 = p.End.clone().applyMatrix4(
                this._particleSystem.modelViewMatrix);
            const v2 = p.Start.clone().applyMatrix4(
                this._particleSystem.modelViewMatrix);
            const dir = new THREE.Vector3().subVectors(v1, v2);
            dir.z = 0;
            dir.normalize();

            const up = new THREE.Vector3(-dir.y, dir.x, 0);

            const dirWS = up.clone().transformDirection(
                this._game._graphics._camera.matrixWorld);
            dirWS.multiplyScalar(p.Width);

            const p1 = new THREE.Vector3().copy(p.Start);
            p1.add(dirWS);

            const p2 = new THREE.Vector3().copy(p.Start);
            p2.sub(dirWS);

            const p3 = new THREE.Vector3().copy(p.End);
            p3.sub(dirWS);

            const p4 = new THREE.Vector3().copy(p.End);
            p4.add(dirWS);

            positions.push(p1.x, p1.y, p1.z);
            positions.push(p2.x, p2.y, p2.z);
            positions.push(p3.x, p3.y, p3.z);
            positions.push(p4.x, p4.y, p4.z);

            uvs.push(0.0, 0.0);
            uvs.push(1.0, 0.0);
            uvs.push(1.0, 1.0);
            uvs.push(0.0, 1.0);

            const c = p.Colours[0].lerp(
                p.Colours[1], 1.0 - p.Life / p.TotalLife);
            for (let i = 0; i < 4; i++) {
              colors.push(c.r, c.g, c.b);
            }
          }

          this._geometry.setAttribute(
              'position', new THREE.Float32BufferAttribute(positions, 3));
          this._geometry.setAttribute(
              'uv', new THREE.Float32BufferAttribute(uvs, 2));
          this._geometry.setAttribute(
              'color', new THREE.Float32BufferAttribute(colors, 3));
          this._geometry.setIndex(
              new THREE.BufferAttribute(new Uint32Array(indices), 1));

          this._geometry.attributes.position.needsUpdate = true;
          this._geometry.attributes.uv.needsUpdate = true;
        }
      }
  };
})();
