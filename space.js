import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {game} from './game.js';
import {graphics} from './graphics.js';
import {math} from './math.js';
import {visibility} from './visibility.js';
import {particles} from './particles.js';
import {blaster} from './blaster.js';
import {OBJLoader} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/loaders/OBJLoader.js';

let _APP = null;

const _NUM_BOIDS = 300;
const _BOID_SPEED = 25;
const _BOID_ACCELERATION = _BOID_SPEED / 2.5;
const _BOID_FORCE_MAX = _BOID_ACCELERATION / 20.0;
const _BOID_FORCE_ORIGIN = 50;
const _BOID_FORCE_ALIGNMENT = 10;
const _BOID_FORCE_SEPARATION = 20;
const _BOID_FORCE_COLLISION = 50;
const _BOID_FORCE_COHESION = 5;
const _BOID_FORCE_WANDER = 3;


class LineRenderer {
  constructor(game) {
    this._game = game;

    this._materials = {};
    this._group = new THREE.Group();

    this._game._graphics.Scene.add(this._group);
  }

  Reset() {
    this._lines = [];
    this._group.remove(...this._group.children);
  }

  Add(pt1, pt2, hexColour) {
    const geometry = new THREE.Geometry();
    geometry.vertices.push(pt1);
    geometry.vertices.push(pt2);

    let material = this._materials[hexColour];
    if (!material) {
      this._materials[hexColour] = new THREE.LineBasicMaterial(
          {color: hexColour});
      material = this._materials[hexColour];
    }

    const line = new THREE.Line(geometry, material);
    this._lines.push(line);
    this._group.add(line);
  }
}

class ExplodeParticles {
  constructor(game) {
    this._particleSystem = new particles.ParticleSystem(
        game, {texture: "./resources/blaster.jpg"});
    this._particles = [];
  }

  Splode(origin) {
    for (let i = 0; i < 128; i++) {
      const p = this._particleSystem.CreateParticle();
      p.Position.copy(origin);
      p.Velocity = new THREE.Vector3(
          math.rand_range(-1, 1),
          math.rand_range(-1, 1),
          math.rand_range(-1, 1)
      );
      p.Velocity.normalize();
      p.Velocity.multiplyScalar(125);
      p.TotalLife = 2.0;
      p.Life = p.TotalLife;
      p.Colours = [new THREE.Color(0xFF8000), new THREE.Color(0x800000)];
      p.Sizes = [3, 12];
      p.Size = p.Sizes[0];
      this._particles.push(p);
    }
  }

  Update(timeInSeconds) {
    this._particles = this._particles.filter(p => {
      return p.Alive;
    });
    for (const p of this._particles) {
      p.Life -= timeInSeconds;
      if (p.Life <= 0) {
        p.Alive = false;
      }
      p.Position.add(p.Velocity.clone().multiplyScalar(timeInSeconds));
      p.Velocity.multiplyScalar(0.75);
      p.Size = math.lerp(p.Life / p.TotalLife, p.Sizes[0], p.Sizes[1]);
      p.Colour.copy(p.Colours[0]);
      p.Colour.lerp(p.Colours[1], 1.0 - p.Life / p.TotalLife);
    }
    this._particleSystem.Update();
  }
};


class Boid {
  constructor(game, params) {
    this._mesh = new THREE.Mesh(
        params.geometry,
        new THREE.MeshStandardMaterial({color: 0x808080}));
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = false;

    this._group = new THREE.Group();
    this._group.add(this._mesh);
    this._group.position.set(
        math.rand_range(-250, 250),
        math.rand_range(-250, 250),
        math.rand_range(-250, 250));
    this._direction = new THREE.Vector3(
        math.rand_range(-1, 1),
        math.rand_range(-1, 1),
        math.rand_range(-1, 1));
    this._velocity = this._direction.clone();

    const speedMultiplier = math.rand_range(params.speedMin, params.speedMax);
    this._maxSteeringForce = params.maxSteeringForce * speedMultiplier;
    this._maxSpeed  = params.speed * speedMultiplier;
    this._acceleration = params.acceleration * speedMultiplier;

    const scale = 1.0 / speedMultiplier;
    this._radius = scale;
    this._mesh.scale.setScalar(scale * params.scale);
    //this._mesh.rotateX(Math.PI / 2);

    this._game = game;
    game._graphics.Scene.add(this._group);
    this._visibilityIndex = game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this);

    this._wanderAngle = 0;
    this._seekGoal = params.seekGoal;
    this._fireCooldown = 0.0;
    this._params = params;
  }

  DisplayDebug() {
    const geometry = new THREE.SphereGeometry(10, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0xFF0000,
      transparent: true,
      opacity: 0.25,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this._group.add(mesh);

    this._mesh.material.color.setHex(0xFF0000);
    this._displayDebug = true;
    this._lineRenderer = new LineRenderer(this._game);
  }

  _UpdateDebug(local) {
    this._lineRenderer.Reset();
    this._lineRenderer.Add(
        this.Position, this.Position.clone().add(this._velocity),
        0xFFFFFF);
    for (const e of local) {
      this._lineRenderer.Add(this.Position, e.Position, 0x00FF00);
    }
  }

  get Position() {
    return this._group.position;
  }

  get Velocity() {
    return this._velocity;
  }

  get Direction() {
    return this._direction;
  }

  get Radius() {
    return this._radius;
  }

  Step(timeInSeconds) {
    const local = this._game._visibilityGrid.GetLocalEntities(
        this.Position, 15);

    this._ApplySteering(timeInSeconds, local);

    const frameVelocity = this._velocity.clone();
    frameVelocity.multiplyScalar(timeInSeconds);
    this._group.position.add(frameVelocity);

    this._group.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), this.Direction);

    this._visibilityIndex = this._game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this, this._visibilityIndex);

    if (this._displayDebug) {
      this._UpdateDebug(local);
    }
  }

  _ApplySteering(timeInSeconds, local) {
    const separationVelocity = this._ApplySeparation(local);

    // Only apply alignment and cohesion to allies
    const allies = local.filter((e) => {
      return this._seekGoal.equals(e._seekGoal);
    });

    const enemies = local.filter((e) => {
      return !this._seekGoal.equals(e._seekGoal);
    });

    this._fireCooldown -= timeInSeconds;
    if (enemies.length > 0 && this._fireCooldown <= 0) {
      const p = this._game._blasters.CreateParticle();
      p.Start = this.Position.clone();
      p.End = this.Position.clone();
      p.Velocity = this.Direction.clone().multiplyScalar(300);
      p.Length = 50;
      p.Colours = [
          this._params.colour.clone(), new THREE.Color(0.0, 0.0, 0.0)];
      p.Life = 2.0;
      p.TotalLife = 2.0;
      p.Width = 0.25;

      if (Math.random() < 0.025) {
        this._game._explosionSystem.Splode(enemies[0].Position);
      }
      this._fireCooldown = 0.25;
    }

    const alignmentVelocity = this._ApplyAlignment(allies);
    const cohesionVelocity = this._ApplyCohesion(allies);
    const originVelocity = this._ApplySeek(this._seekGoal);
    const wanderVelocity = this._ApplyWander();
    const collisionVelocity = this._ApplyCollisionAvoidance();

    const steeringForce = new THREE.Vector3(0, 0, 0);
    steeringForce.add(separationVelocity);
    steeringForce.add(alignmentVelocity);
    steeringForce.add(cohesionVelocity);
    steeringForce.add(originVelocity);
    steeringForce.add(wanderVelocity);
    steeringForce.add(collisionVelocity);

    steeringForce.multiplyScalar(this._acceleration * timeInSeconds);

    // Clamp the force applied
    if (steeringForce.length() > this._maxSteeringForce) {
      steeringForce.normalize();
      steeringForce.multiplyScalar(this._maxSteeringForce);
    }

    this._velocity.add(steeringForce);

    // Clamp velocity
    if (this._velocity.length() > this._maxSpeed) {
      this._velocity.normalize();
      this._velocity.multiplyScalar(this._maxSpeed);
    }

    this._direction = this._velocity.clone();
    this._direction.normalize();
  }

  _ApplyCollisionAvoidance() {
    const colliders = this._game._visibilityGrid.GetGlobalItems();

    const ray = new THREE.Ray(this.Position, this.Direction);
    const force = new THREE.Vector3(0, 0, 0);

    for (const c of colliders) {
      if (c.Position.distanceTo(this.Position) > c.QuickRadius) {
        continue;
      }

      const result = ray.intersectBox(c.AABB, new THREE.Vector3());
      if (result) {
        const distanceToCollision = result.distanceTo(this.Position);
        if (distanceToCollision < 2) {
          let a = 0;
        }
        const dirToCenter = c.Position.clone().sub(this.Position).normalize();
        const dirToCollision = result.clone().sub(this.Position).normalize();
        const steeringDirection = dirToCollision.sub(dirToCenter).normalize();
        steeringDirection.multiplyScalar(_BOID_FORCE_COLLISION);
        force.add(steeringDirection);
      }
    }

    return force;
  }

  _ApplyWander() {
    this._wanderAngle += 0.1 * math.rand_range(-2 * Math.PI, 2 * Math.PI);
    const randomPointOnCircle = new THREE.Vector3(
        Math.cos(this._wanderAngle),
        0,
        Math.sin(this._wanderAngle));
    const pointAhead = this._direction.clone();
    pointAhead.multiplyScalar(5);
    pointAhead.add(randomPointOnCircle);
    pointAhead.normalize();
    return pointAhead.multiplyScalar(_BOID_FORCE_WANDER);
  }

  _ApplySeparation(local) {
    if (local.length == 0) {
      return new THREE.Vector3(0, 0, 0);
    }

    const forceVector = new THREE.Vector3(0, 0, 0);
    for (let e of local) {
      const distanceToEntity = Math.max(
          e.Position.distanceTo(this.Position) - 1.5 * (this.Radius + e.Radius),
          0.001);
      const directionFromEntity = new THREE.Vector3().subVectors(
          this.Position, e.Position);
      const multiplier = (_BOID_FORCE_SEPARATION / distanceToEntity);
      directionFromEntity.normalize();
      forceVector.add(
          directionFromEntity.multiplyScalar(multiplier));
    }
    return forceVector;
  }

  _ApplyAlignment(local) {
    const forceVector = new THREE.Vector3(0, 0, 0);

    for (let e of local) {
      const entityDirection = e.Direction;
      forceVector.add(entityDirection);
    }

    forceVector.normalize();
    forceVector.multiplyScalar(_BOID_FORCE_ALIGNMENT);

    return forceVector;
  }

  _ApplyCohesion(local) {
    const forceVector = new THREE.Vector3(0, 0, 0);

    if (local.length == 0) {
      return forceVector;
    }

    const averagePosition = new THREE.Vector3(0, 0, 0);
    for (let e of local) {
      averagePosition.add(e.Position);
    }

    averagePosition.multiplyScalar(1.0 / local.length);

    const directionToAveragePosition = averagePosition.clone().sub(
        this.Position);
    directionToAveragePosition.normalize();
    directionToAveragePosition.multiplyScalar(_BOID_FORCE_COHESION);

    // HACK: Floating point error from accumulation of positions.
    directionToAveragePosition.y = 0;

    return directionToAveragePosition;
  }

  _ApplySeek(destination) {
    const distance = Math.max(0,((
        this.Position.distanceTo(destination) - 50) / 500)) ** 2;
    const direction = destination.clone().sub(this.Position);
    direction.normalize();

    const forceVector = direction.multiplyScalar(
        _BOID_FORCE_ORIGIN * distance);
    return forceVector;
  }
}


class OpenWorldDemo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._entities = [];

    this._bloomPass = this._graphics.AddPostFX(
        graphics.PostFX.UnrealBloomPass,
        {
            threshold: 0.75,
            strength: 2.5,
            radius: 0,
            resolution: {
              x: 1024,
              y: 1024,
            }
        });

    this._glitchPass = this._graphics.AddPostFX(
        graphics.PostFX.GlitchPass, {});
    this._glitchCooldown = 15;

    this._glitchPass.enabled = false;

    this._LoadBackground();

    const geometries = {};
    const loader = new OBJLoader();
    loader.load("./resources/fighter.obj", (result) => {
      geometries.fighter = result.children[0].geometry;
      loader.load("./resources/cruiser.obj", (result) => {
        geometries.cruiser = result.children[0].geometry;
        this._CreateBoids(geometries);
      });
    });
    this._CreateEntities();
  }

  _LoadBackground() {
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
        './resources/space-posx.jpg',
        './resources/space-negx.jpg',
        './resources/space-posy.jpg',
        './resources/space-negy.jpg',
        './resources/space-posz.jpg',
        './resources/space-negz.jpg',
    ]);
    this._graphics._scene.background = texture;
  }

  _CreateEntities() {
    // This is 2D but eh, whatever.
    this._visibilityGrid = new visibility.VisibilityGrid(
        [new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 0, 500)],
        [100, 100]);

    this._explosionSystem = new ExplodeParticles(this);

    this._blasters = new blaster.BlasterSystem(
        this, {texture: "./resources/blaster.jpg"});
  }

  _CreateBoids(geometries) {
    const positions = [
        new THREE.Vector3(-200, 50, -100),
        new THREE.Vector3(0, 0, 0)];
    const colours = [
        new THREE.Color(0.5, 0.5, 4.0),
        new THREE.Color(4.0, 0.5, 0.5)
    ];
    for (let i = 0; i < 2; i++) {
      const p = positions[i];
      const cruiser = new THREE.Mesh(
          geometries.cruiser,
          new THREE.MeshStandardMaterial({
              color: 0x404040
          }));
      cruiser.position.set(p.x, p.y, p.z);
      cruiser.castShadow = true;
      cruiser.receiveShadow = true;
      cruiser.rotation.x = Math.PI / 2;
      cruiser.scale.setScalar(10, 10, 10);
      cruiser.updateWorldMatrix();
      this._graphics.Scene.add(cruiser);

      cruiser.geometry.computeBoundingBox();
      const b = cruiser.geometry.boundingBox.clone().applyMatrix4(
          cruiser.matrixWorld);

      this._visibilityGrid.AddGlobalItem({
        Position: p,
        AABB: b,
        QuickRadius: 200,
        Velocity: new THREE.Vector3(0, 0, 0),
        Direction: new THREE.Vector3(0, 1, 0),
      });

      let params = {
        geometry: geometries.fighter,
        speedMin: 1.0,
        speedMax: 1.0,
        speed: _BOID_SPEED,
        maxSteeringForce: _BOID_FORCE_MAX,
        acceleration: _BOID_ACCELERATION,
        scale: 0.4,
        seekGoal: p,
        colour: colours[i]
      };
      for (let i = 0; i < _NUM_BOIDS; i++) {
        const e = new Boid(this, params);
        this._entities.push(e);
      }
    }

    //this._entities[0].DisplayDebug();
  }

  _OnStep(timeInSeconds) {
    timeInSeconds = Math.min(timeInSeconds, 1 / 10.0);

    this._blasters.Update(timeInSeconds);
    this._explosionSystem.Update(timeInSeconds);

    this._glitchCooldown -= timeInSeconds;
    if (this._glitchCooldown < 0) {
      this._glitchCooldown = math.rand_range(5, 10);
      this._glitchPass.enabled = !this._glitchPass.enabled;
    }

    this._StepEntities(timeInSeconds);
  }

  _StepEntities(timeInSeconds) {
    if (this._entities.length == 0) {
      return;
    }

    for (let e of this._entities) {
      e.Step(timeInSeconds);
    }
  }
}


function _Main() {
  _APP = new OpenWorldDemo();
}

_Main();
