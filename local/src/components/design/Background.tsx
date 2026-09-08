import { useEffect, useRef } from "react";
import video from "../../assets/design/background.mp4?no-inline";
import poster from "../../assets/design/background.webp?no-inline";

export default function Background() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) media.pause();
      else void media.play().catch(() => {});
    };
    query.addEventListener("change", apply);
    apply();
    return () => query.removeEventListener("change", apply);
  }, []);
  return (
    <div className="design-background" aria-hidden="true">
      <video
        ref={videoRef}
        src={video}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="background-light" />
      <div className="background-dark">
        <div className="lines-1" />
        <div className="lines-2" />
      </div>
    </div>
  );
}
