import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {GUI} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/dat.gui.module.js';
import {game} from './game.js';
import {graphics} from './graphics.js';
import {math} from './math.js';
import {visibility} from './visibility.js';

let _APP = null;

const _NUM_BOIDS = 30;
const _BOID_SPEED = 5;
const _BOID_ACCELERATION = _BOID_SPEED / 5.0;
const _BOID_FORCE_MAX = _BOID_ACCELERATION / 10.0;
const _BOID_FORCE_ALIGNMENT = 5;
const _BOID_FORCE_SEPARATION = 8;
const _BOID_FORCE_COHESION = 4;
const _BOID_FORCE_WANDER = 5;


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
    geometry.vertices.push(pt1.clone());
    geometry.vertices.push(pt2.clone());

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
        0,
        math.rand_range(-50, 50));
    this._direction = new THREE.Vector3(
        math.rand_range(-1, 1),
        0,
        math.rand_range(-1, 1));
    this._velocity = this._direction.clone();

    this._maxSteeringForce = params.maxSteeringForce;
    this._maxSpeed  = params.speed;
    this._acceleration = params.acceleration;

    this._radius = 1.0;
    this._mesh.rotateX(-Math.PI / 2);

    this._game = game;
    game._graphics.Scene.add(this._group);
    this._visibilityIndex = game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this);

    this._wanderAngle = 0;
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
      this._lineRenderer.Add(
          e.Position, e.Position.clone().add(e._velocity),
          0xFFFFFF);
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

  CheckBounds() {
    const pos = this._group.position;
    if (pos.x > 65) {
      pos.x = -65;
    } else if (pos.x < -65) {
      pos.x = 65;
    } else if (pos.z < -35) {
      pos.z = 35;
    } else if (pos.z > 35) {
      pos.z = -35;
    }

    this._visibilityIndex = this._game._visibilityGrid.UpdateItem(
        this._mesh.uuid, this, this._visibilityIndex);
  }

  _ApplySteering(timeInSeconds, local) {
    const forces = [
      this._ApplyWander(),
    ];

    if (this._params.guiParams.separationEnabled) {
      forces.push(this._ApplySeparation(local));
    }

    if (this._params.guiParams.alignmentEnabled) {
      forces.push(this._ApplyAlignment(local));
    }

    if (this._params.guiParams.cohesionEnabled) {
      forces.push(this._ApplyCohesion(local));
    }

    const steeringForce = new THREE.Vector3(0, 0, 0);
    for (const f of forces) {
      steeringForce.add(f);
    }

    steeringForce.multiplyScalar(this._acceleration * timeInSeconds);

    // Lock to xz dimension
    steeringForce.multiply(new THREE.Vector3(1, 0, 1));

    // Clamp the force applied
    steeringForce.normalize();
    steeringForce.multiplyScalar(this._maxSteeringForce);

    this._velocity.add(steeringForce);

    // Lock velocity for debug mode
    this._velocity.normalize();
    this._velocity.multiplyScalar(this._maxSpeed);

    this._direction = this._velocity.clone();
    this._direction.normalize();
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






  _CalculateSeparationForce() {
    totalForce = 0;
    for (every boid in the area) {
      totalForce += (ourPosition - theirPosition) / distanceBetween;
    }
    return totalForce;
  }









































  _CalculateSeparationForce(local) {
    const forceVector = new THREE.Vector3(0, 0, 0);
    for (let e of local) {
      const distanceToEntity = Math.max(
          e.Position.distanceTo(this.Position) - (this.Radius + e.Radius),
          0.001);
      const directionFromEntity = new THREE.Vector3().subVectors(
          this.Position, e.Position);
      directionFromEntity.normalize();

      const multiplier = _BOID_FORCE_SEPARATION * (
          (this.Radius + e.Radius) / distanceToEntity);

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
}


class DebugDemo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._entities = [];

    this._guiParams = {
      separationEnabled: false,
      cohesionEnabled: false,
      alignmentEnabled: false,
    };
    this._gui = new GUI();
    this._gui.add(this._guiParams, "separationEnabled");
    this._gui.add(this._guiParams, "cohesionEnabled");
    this._gui.add(this._guiParams, "alignmentEnabled");
    this._gui.close();

    const geoLibrary = {
      cone: new THREE.ConeGeometry(1, 2, 32)
    };
    this._CreateEntities();
    this._CreateBoids(geoLibrary);
  }

  _CreateEntities() {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400, 32, 32),
        new THREE.MeshStandardMaterial({
            color: 0x808080,
            transparent: false,
        }));
    plane.position.set(0, -2, 0);
    plane.castShadow = false;
    plane.receiveShadow = false;
    plane.rotation.x = -Math.PI / 2;
    this._graphics.Scene.add(plane);

    this._visibilityGrid = new visibility.VisibilityGrid(
        [new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 0, 500)],
        [100, 100]);
    this._graphics._camera.position.set(0, 50, 0);
    this._controls.target.set(0, 0, 0);
    this._controls.update();
  }

  _CreateBoids(geoLibrary) {
    let params = {
      geometry: geoLibrary.cone,
      speedMin: 1.0,
      speedMax: 1.0,
      speed: _BOID_SPEED,
      maxSteeringForce: _BOID_FORCE_MAX,
      acceleration: _BOID_ACCELERATION,
      colour: 0x80FF80,
      guiParams: this._guiParams
    };
    for (let i = 0; i < _NUM_BOIDS * 2; i++) {
      const e = new Boid(this, params);
      this._entities.push(e);
    }
    this._entities[0].DisplayDebug();
  }

  _OnStep(timeInSeconds) {
    timeInSeconds = Math.min(timeInSeconds, 1 / 10.0);

    if (this._entities.length == 0) {
      return;
    }

    for (let e of this._entities) {
      e.Step(timeInSeconds);
    }

    for (let e of this._entities) {
      // Teleport to other side if offscreen
      e.CheckBounds();
    }
  }
}


function _Main() {
  _APP = new DebugDemo();
}

_Main();
