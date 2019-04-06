// maps file extentions to MIME types
const mimeTypeMap = {
  ico: "image/x-icon",
  html: "text/html",
  js: "text/javascript",
  json: "application/json",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  eot: "appliaction/vnd.ms-fontobject",
  ttf: "aplication/font-sfnt"
};


export function getMemeType(filename: string) {
    const extension = filename.split(".").slice(-1)[0];

    return mimeTypeMap[extension];
}
