import type {TemplateProject} from './schema';

export function createDefaultProject(): TemplateProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: 'Untitled Device Template',
    canvas: {width: 1280, height: 720, fps: 30, durationInFrames: 450},
    model: {fileName: 'Untitled.glb', position: [0, 0, 0], rotation: [-15, 25, 0], scale: 1, pivot: [0, 0, 0], frontAxis: '+Z', defaultTransform: {position:[0,0,0],rotation:[-15,25,0],scale:1,pivot:[0,0,0],frontAxis:'+Z'}},
    camera: {position:[0,0.6,4],target:[0,0,0],fov:35,defaultPosition:[0,0.6,4],defaultTarget:[0,0,0]},
    screen: {materialName: '17ProMax_Screen', fit: 'fill', flipY: false, rotation: 0, offset: [0, 0], scale: [1, 1], emissionIntensity: 1},
    animation: {preset: 'Flip Reveal', direction: 'Left', durationInFrames: 60, intensity: 75},
    background: {preset: 'Lilac Glow'},
    layers: [
      {id: 'camera', type: 'camera', name: 'Camera', startFrame: 0, durationInFrames: 450, visible: true, locked: true, zIndex: 0, color: '#9dc6ff'},
      {id: 'phone', type: 'device', name: 'Pro Phone', startFrame: 0, durationInFrames: 450, visible: true, locked: false, zIndex: 1, color: '#b9a9ff'},
      {id: 'media', type: 'screen-media', name: 'Screen Media', startFrame: 0, durationInFrames: 450, visible: true, locked: false, zIndex: 2, color: '#8fbdfd'},
      {id: 'title', type: 'text', name: 'Title', startFrame: 16, durationInFrames: 177, visible: true, locked: false, zIndex: 3, color: '#c0aaff', content: 'Your app. Beautifully launched.'},
      {id: 'background', type: 'background', name: 'Background', startFrame: 0, durationInFrames: 450, visible: true, locked: true, zIndex: -1, color: '#b9c4d3'},
    ],
    createdAt: now,
    updatedAt: now,
  };
}
