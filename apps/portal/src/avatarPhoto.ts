/** Crop locally so the original photo and its camera metadata stay on the device. */
export async function prepareAvatarPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.size === 0 || file.size > 20 * 1024 * 1024) {
    throw new Error("invalid-photo");
  }
  // The portal's image policy permits local data URLs, but intentionally does
  // not grant blob: images. Reading locally also keeps the original off the network.
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid-photo"));
    reader.onerror = () => reject(new Error("invalid-photo"));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("invalid-photo"));
    image.src = url;
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side < 32) throw new Error("invalid-photo");
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("invalid-photo");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 256, 256);
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
  const result = canvas.toDataURL("image/jpeg", 0.84);
  if (!result.startsWith("data:image/jpeg;base64,") || result.length > 174_790) throw new Error("invalid-photo");
  return result;
}
