const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");

const coverageServices = [
  {
    id: "starlite",
    name: "Starlite",
    url: "https://starliteindonesia.com/api/app/coverage/check",
  },
  {
    id: "internet-rakyat",
    name: "Internet Rakyat",
    url: "https://internetrakyat.id/api/app/coverage/check",
  },
];

const staticFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyBytes = 0;

    request.on("data", (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        reject(new Error("Request body terlalu besar."));
        request.destroy();
        return;
      }
      body += chunk;
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Body harus berupa JSON yang valid."));
      }
    });

    request.on("error", reject);
  });
}

function requestCoverage(service, coordinates) {
  return new Promise((resolve) => {
    const body = JSON.stringify(coordinates);
    const request = https.request(
      service.url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let data;
          try {
            data = JSON.parse(responseBody);
          } catch {
            data = responseBody;
          }

          resolve({
            id: service.id,
            name: service.name,
            success:
              response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            data,
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Permintaan ke layanan melewati batas waktu."));
    });
    request.on("error", (error) => {
      resolve({
        id: service.id,
        name: service.name,
        success: false,
        error: error.message,
      });
    });
    request.end(body);
  });
}

function serveStatic(request, response, pathname) {
  const asset = staticFiles[pathname];
  if (!asset || request.method !== "GET") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(path.join(PUBLIC_DIR, asset.file), (error, contents) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Gagal membaca file aplikasi.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
    });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === "/api/coverage") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan metode POST." });
      return;
    }

    let coordinates;
    try {
      coordinates = await readJsonBody(request);
    } catch (error) {
      if (!response.destroyed) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    const { latitude, longitude } = coordinates || {};
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      sendJson(response, 400, {
        error: "Koordinat latitude dan longitude tidak valid.",
      });
      return;
    }

    const results = await Promise.all(
      coverageServices.map((service) =>
        requestCoverage(service, { latitude, longitude })
      )
    );

    if (results.every((result) => !result.success)) {
      sendJson(response, 502, { results });
      return;
    }

    sendJson(response, 200, { results });
    return;
  }

  serveStatic(request, response, pathname);
});

server.listen(PORT, () => {
  console.log(`Peta coverage aktif di http://localhost:${PORT}`);
});
