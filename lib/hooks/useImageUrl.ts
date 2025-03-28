import { useState, useEffect } from "react";
import * as fileStorage from "../storage/fileStorage";

export function useImageUrl(storageKey: string | undefined, fallbackUrl: string = "/placeholder.svg") {
  const [imageUrl, setImageUrl] = useState<string>(fallbackUrl);

  useEffect(() => {
    // Reset to fallback when key changes
    setImageUrl(fallbackUrl);
    
    if (!storageKey) {
      return;
    }
    
    let objectUrl: string | undefined;
    
    const loadImage = async () => {
      try {
        // For our Xenogenesis image, use the direct file path
        if (storageKey === "default-xenogenesis-cover") {
          setImageUrl("/Xenogenesis.jpg");
          return;
        }
        
        // For other images, try to load from IndexedDB
        objectUrl = await fileStorage.getImageFileUrl(storageKey);
        setImageUrl(objectUrl);
      } catch (error) {
        console.error("Failed to load image:", error);
        setImageUrl(fallbackUrl);
      }
    };
    
    loadImage();
    
    // Clean up object URL when component unmounts or key changes
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [storageKey, fallbackUrl]);
  
  return imageUrl;
} 