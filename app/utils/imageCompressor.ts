/**
 * Utility Cerdas: Kompresi Gambar di Sisi Klien (Client-Side Image Compression)
 * Menggunakan HTML5 Canvas untuk memperkecil resolusi gambar dan mengompresinya ke format WebP/JPEG
 * guna menjamin ukuran data string Base64 di bawah ~30KB untuk transmisi WebSocket instan.
 */
export const compressImageToBase64 = (file: File, maxDimension: number = 240): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        
        // Hitung rasio rasio aspek untuk menyesuaikan dengan maxDimension
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Gagal mendapatkan konteks 2D Canvas"));
          return;
        }
        
        // Gambar ulang dengan ukuran mini & kualitas tinggi
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
        
        // Ekspor ke format WebP jika didukung (ukuran file jauh lebih kecil!), fallback ke JPEG
        let base64String = canvas.toDataURL("image/webp", 0.6); // Kualitas 60%
        
        // Jika browser tidak dukung webp, data string akan tetap berisi image/png, kita paksa jpeg
        if (base64String.startsWith("data:image/png")) {
          base64String = canvas.toDataURL("image/jpeg", 0.6);
        }
        
        resolve(base64String);
      };
      
      img.onerror = (err) => reject(err);
    };
    
    reader.onerror = (err) => reject(err);
  });
};
