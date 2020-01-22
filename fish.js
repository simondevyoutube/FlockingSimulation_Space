import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {game} from './game.js';
import {math} from './math.js';
import {visibility} from './visibility.js';
import {OBJLoader} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/loaders/OBJLoader.js';

let _APP = null;

const _NUM_BOIDS = 350;
const _BOID_SPEED = 2.5;
const _BOID_ACCELERATION = _BOID_SPEED / 5.0;
const _BOID_FORCE_MAX = _BOID_ACCELERATION / 10.0;
const _BOID_FORCE_ORIGIN = 8;
const _BOID_FORCE_ALIGNMENT = 10;
const _BOID_FORCE_SEPARATION = 20;
const _BOID_FORCE_COHESION = 10;
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


class Boid {
  constructor(game, params) {
    this._mesh = new THREE.Mesh(
        params.geometry,
        new THREE.MeshStandardMaterial({color: params.colour}));
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = false;

    this._group = new THREE.Group();
    this._group.add(this._mesh);
    this._group.position.set(
        math.rand_range(-50, 50),
        math.rand_range(1, 25),
        math.rand_range(-50, 50));
    this._direction = new THREE.Vector3(
        math.rand_range(-1, 1),
        0,
        math.rand_range(-1, 1));
    this._velocity = this._direction.clone();

    const speedMultiplier = math.rand_range(params.speedMin, params.speedMax);
    this._maxSteeringForce = params.maxSteeringForce * speedMultiplier;
    this._maxSpeed  = params.speed * speedMultiplier;
    this._acceleration = params.acceleration * speedMultiplier;

    const scale = 1.0 / speedMultiplier;
    this._radius = scale;
    this._mesh.scale.setScalar(scale);
    this._mesh.rotateX(-Math.PI / 2);

    this._game = game;
    game._graphics.Scene.add(this._group);
    this._visibilityIndex = game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this);

    this._wanderAngle = 0;
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
    if (this._displayDebug) {
      let a = 0;
    }

    const local = this._game._visibilityGrid.GetLocalEntities(
        this.Position, 15);

    this._ApplySteering(timeInSeconds, local);

    const frameVelocity = this._velocity.clone();
    frameVelocity.multiplyScalar(timeInSeconds);
    this._group.position.add(frameVelocity);

    const direction = this.Direction;
    const m = new THREE.Matrix4();
    m.lookAt(
        new THREE.Vector3(0, 0, 0),
        direction,
        new THREE.Vector3(0, 1, 0));
    this._group.quaternion.setFromRotationMatrix(m);

    this._visibilityIndex = this._game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this, this._visibilityIndex);

    if (this._displayDebug) {
      this._UpdateDebug(local);
    }
  }

  _ApplySteering(timeInSeconds, local) {
    const forces = [
      this._ApplySeek(new THREE.Vector3(0, 10, 0)),
      this._ApplyWander(),
      this._ApplyGroundAvoidance(),
      this._ApplySeparation(local),
    ];

    if (this._radius < 5) {
      // Only apply alignment and cohesion to similar sized fish.
      local = local.filter((e) => {
        const ratio = this.Radius / e.Radius;

        return (ratio <= 1.35 && ratio >= 0.75);
      });

      forces.push(
        this._ApplyAlignment(local),
        this._ApplyCohesion(local),
        this._ApplySeparation(local)
      )
    }

    const steeringForce = new THREE.Vector3(0, 0, 0);
    for (const f of forces) {
      steeringForce.add(f);
    }

    steeringForce.multiplyScalar(this._acceleration * timeInSeconds);

    // Preferentially move in x/z dimension
    steeringForce.multiply(new THREE.Vector3(1, 0.25, 1));

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

  _ApplyGroundAvoidance() {
    const p = this.Position;
    let force = new THREE.Vector3(0, 0, 0);

    if (p.y < 10) {
      force = new THREE.Vector3(0, 10 - p.y, 0);
    } else if (p.y > 30) {
      force = new THREE.Vector3(0, p.y - 50, 0);
    }
    return force.multiplyScalar(_BOID_FORCE_SEPARATION);
  }

  _ApplyWander() {
    this._wanderAngle += 0.1 * math.rand_range(-2 * Math.PI, 2 * Math.PI);
    const randomPointOnCircle = new THREE.Vector3(
        Math.cos(this._wanderAngle),
        0,
        Math.sin(this._wanderAngle));
    const pointAhead = this._direction.clone();
    pointAhead.multiplyScalar(2);
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
      const multiplier = (
          _BOID_FORCE_SEPARATION / distanceToEntity) * (this.Radius + e.Radius);
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

    return directionToAveragePosition;
  }

  _ApplySeek(destination) {
    const distance = Math.max(0,((
        this.Position.distanceTo(destination) - 50) / 250)) ** 2;
    const direction = destination.clone().sub(this.Position);
    direction.normalize();

    const forceVector = direction.multiplyScalar(
        _BOID_FORCE_ORIGIN * distance);
    return forceVector;
  }
}


class FishDemo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._entities = [];

    this._graphics.Scene.fog = new THREE.FogExp2(
        new THREE.Color(0x4d7dbe), 0.01);

    this._LoadBackground();

    const loader = new OBJLoader();
    const geoLibrary = {};
    loader.load("./resources/fish.obj", (result) => {
      geoLibrary.fish = result.children[0].geometry;
      loader.load("./resources/bigfish.obj", (result) => {
        geoLibrary.bigFish = result.children[0].geometry;
        this._CreateBoids(geoLibrary);
      });
    });
    this._CreateEntities();
  }

  _LoadBackground() {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('./resources/underwater.jpg');
    this._graphics._scene.background = texture;
  }

  _CreateEntities() {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400, 32, 32),
        new THREE.MeshStandardMaterial({
            color: 0x837860,
            transparent: true,
            opacity: 0.5,
        }));
    plane.position.set(0, -5, 0);
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    this._graphics.Scene.add(plane);

    this._visibilityGrid = new visibility.VisibilityGrid(
        [new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 0, 500)],
        [100, 100]);

  }

  _CreateBoids(geoLibrary) {
    const NUM_SMALL = _NUM_BOIDS * 2;
    const NUM_MEDIUM = _NUM_BOIDS / 2;
    const NUM_LARGE = _NUM_BOIDS / 20;
    const NUM_WHALES = 3;

    let params = {
      geometry: geoLibrary.fish,
      speedMin: 3.0,
      speedMax: 4.0,
      speed: _BOID_SPEED,
      maxSteeringForce: _BOID_FORCE_MAX,
      acceleration: _BOID_ACCELERATION,
      colour: 0x80FF80,
    };
    for (let i = 0; i < NUM_SMALL; i++) {
      const e = new Boid(this, params);
      this._entities.push(e);
    }

    params = {
      geometry: geoLibrary.fish,
      speedMin: 0.85,
      speedMax: 1.1,
      speed: _BOID_SPEED,
      maxSteeringForce: _BOID_FORCE_MAX,
      acceleration: _BOID_ACCELERATION,
      colour: 0x8080FF,
    };
    for (let i = 0; i < NUM_MEDIUM; i++) {
      const e = new Boid(this, params);
      this._entities.push(e);
    }

    params = {
      geometry: geoLibrary.fish,
      speedMin: 0.4,
      speedMax: 0.6,
      speed: _BOID_SPEED,
      maxSteeringForce: _BOID_FORCE_MAX / 4,
      acceleration: _BOID_ACCELERATION,
      colour: 0xFF8080,
    };
    for (let i = 0; i < NUM_LARGE; i++) {
      const e = new Boid(this, params);
      this._entities.push(e);
    }

    params = {
      geometry: geoLibrary.bigFish,
      speedMin: 0.1,
      speedMax: 0.12,
      speed: _BOID_SPEED,
      maxSteeringForce: _BOID_FORCE_MAX / 20,
      acceleration: _BOID_ACCELERATION,
      colour: 0xFF8080,
    };
    for (let i = 0; i < NUM_WHALES; i++) {
      const e = new Boid(this, params);
      e._group.position.y = math.rand_range(23, 26);
      this._entities.push(e);
    }
    //this._entities[0].DisplayDebug();
  }

  _OnStep(timeInSeconds) {
    timeInSeconds = Math.min(timeInSeconds, 1 / 10.0);

    if (this._entities.length == 0) {
      return;
    }

    // const eye = this._entities[0].Position.clone();
    // const dir = this._entities[0].Direction.clone();
    // dir.multiplyScalar(5);
    // eye.sub(dir);
    //
    // const m = new THREE.Matrix4();
    // m.lookAt(eye, this._entities[0].Position, new THREE.Vector3(0, 1, 0));
    //
    // const q = new THREE.Quaternion();
    // q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    //
    // const oldPosition = this._graphics._camera.position;
    // this._graphics._camera.position.lerp(eye, 0.05);
    // this._graphics._camera.quaternion.copy(this._entities[0]._group.quaternion);
    // //this._graphics._camera.quaternion.multiply(q);
    // this._controls.enabled = false;

    for (let e of this._entities) {
      e.Step(timeInSeconds);
    }
  }
}


function _Main() {
  _APP = new FishDemo();
}

_Main();
