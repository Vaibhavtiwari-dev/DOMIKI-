import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Icosahedron } from '@react-three/drei';
import { useNavigate } from 'react-router-dom';
import type { Mesh } from 'three';

const CoreMonolith = () => {
  const meshRef = useRef<Mesh>(null);
  const meshRefInner = useRef<Mesh>(null);

  useFrame((_state, delta) => {
    if (meshRef.current && meshRefInner.current) {
      meshRef.current.rotation.x += delta * 0.1;
      meshRef.current.rotation.y += delta * 0.15;
      meshRefInner.current.rotation.x -= delta * 0.2;
      meshRefInner.current.rotation.z += delta * 0.1;
    }
  });

  return (
    <group>
      <Icosahedron ref={meshRef} args={[2.5, 0]}>
        <meshStandardMaterial 
          color="#E2E8F0" 
          wireframe={true} 
          roughness={0.1}
          metalness={1}
        />
      </Icosahedron>
      <Icosahedron ref={meshRefInner} args={[1.5, 1]}>
        <meshStandardMaterial 
          color="#CCFF00" 
          wireframe={true} 
          transparent
          opacity={0.3}
        />
      </Icosahedron>
    </group>
  );
};

const GlitchForm = () => {
  const navigate = useNavigate();

  const enterDemo = () => {
    window.localStorage.setItem('dokimi_demo_mode', 'true');
    navigate('/demo');
  };

  return (
    <div className="form-section">
      <div className="demo-eyebrow">Private alpha // Demo access</div>
      <h2 className="form-heading">Initialize<br/>Demo.</h2>
      <p className="form-subtext">
        Enter the Project Dokimi showcase with a preconfigured strategy and synthetic market data.
        No credentials are required for this build.
      </p>

      <button className="btn-avant" type="button" onClick={enterDemo}>
        Initialize Session
      </button>
      <p className="demo-disclaimer">DEMO BYPASS ACTIVE // PAPER &amp; SYNTHETIC DATA ONLY</p>
      
      <div style={{ marginTop: 'auto', paddingTop: 'clamp(2rem, 5vh, 4rem)', fontSize: 'clamp(0.7rem, 1.5vw, 0.85rem)', color: 'var(--dim)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <p>SEC // SEBI // ALG-7</p>
        <p>PROJECT DOKIMI © 2026</p>
      </div>
    </div>
  );
}

export const SignupLanding = () => {
  return (
    <div className="split-layout">
      <div className="noise-overlay"></div>
      
      <div className="canvas-wrapper">
        <h1 className="huge-text absolute-center">
          DOKIMI
        </h1>
        {/* We make the Canvas itself responsive by allowing it to fill its container which scales */}
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <ambientLight intensity={0.1} />
          <directionalLight position={[5, 5, 5]} intensity={2} color="#CCFF00" />
          <directionalLight position={[-5, -5, 5]} intensity={1} color="#E2E8F0" />
          <CoreMonolith />
        </Canvas>
      </div>

      <GlitchForm />
    </div>
  );
};
