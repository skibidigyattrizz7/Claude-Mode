// World constants. Units: metres, seconds. x runs along the pitch length (0..L),
// y across the width (0..W), z is height. Goal "side 0" is at x = 0, side 1 at x = L.

export const PITCH = { L: 84, W: 54 };
export const CX = PITCH.L / 2;
export const CY = PITCH.W / 2;

export const GOAL = { W: 7.32, H: 2.44, D: 2.0 };   // mouth width, crossbar height, net depth
export const BOX = { D: 16.5, W: 40.32 };            // penalty area
export const SIX = { D: 5.5, W: 18.32 };             // goal area
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;
export const CORNER_R = 1;

export const BALL_R = 0.11;
export const POST_R = 0.06;

export const PHYS = {
  G: 9.81,
  DT: 1 / 120,          // fixed physics timestep (120 Hz)
  AIR_K: 0.013,         // quadratic air drag coefficient (1/m)
  ROLL_C: 0.5,          // rolling resistance, constant part (m/s^2)
  ROLL_K: 0.25,         // rolling resistance, linear part (1/s)
  BOUNCE: 0.55,         // vertical restitution on grass
  BOUNCE_MIN: 1.3,      // below this impact speed the ball stops bouncing
  BOUNCE_FRICTION: 0.86,
  MAGNUS: 0.2,          // sideways accel = MAGNUS * spin * speed
  TOPSPIN: 0.16,        // downward accel = TOPSPIN * topspin * speed
  SPIN_DECAY: 0.55,     // spin decays exp(-k t)
  KNUCKLE: 0.09,
  KNUCKLE_FREQ: 11,
  POST_E: 0.62,         // restitution against woodwork
};

// AI difficulty profiles (affects the CPU side only).
export const DIFFICULTY = {
  Easy:   { react: 0.55, acc: 0.55, speed: 0.9,  keeper: 0.8,  press: 0.6,  careful: 0.3 },
  Normal: { react: 0.38, acc: 0.78, speed: 0.97, keeper: 0.95, press: 0.85, careful: 0.6 },
  Hard:   { react: 0.26, acc: 0.9,  speed: 1.02, keeper: 1.05, press: 1.0,  careful: 0.85 },
  Legend: { react: 0.16, acc: 1.0,  speed: 1.07, keeper: 1.12, press: 1.15, careful: 0.95 },
};

export const SHOT_TYPES = {
  driven:  { min: 18, max: 30, z: 0.45, zPow: 0.5, err: 1.0,  label: 'Driven' },
  finesse: { min: 16, max: 24, z: 0.9,  zPow: 0.4, err: 0.8,  label: 'Finesse', curl: 0.85 },
  chip:    { min: 10, max: 15, z: 2.0,  zPow: 0.1, err: 1.1,  label: 'Chip' },
  power:   { min: 27, max: 35, z: 0.9,  zPow: 0.6, err: 1.9,  label: 'Rocket' },
  volley:  { min: 18, max: 28, z: 0.8,  zPow: 0.6, err: 1.6,  label: 'Volley' },
  header:  { min: 10, max: 16, z: 0.7,  zPow: 0.2, err: 1.4,  label: 'Header' },
};
