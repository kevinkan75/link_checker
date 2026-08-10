import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const fixtureDir = fileURLToPath(new URL(".", import.meta.url));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

const fixtureDefinitions = [
  {
    id: "static-html",
    file: "static-html.html",
    path: "/fixtures/static-html",
    expectedPaths: [
      "/static-html/visible-link",
      "/static-html/secondary-link?case=static",
    ],
  },
  {
    id: "csr-basic",
    file: "csr-basic.html",
    path: "/fixtures/csr-basic",
    expectedPaths: [
      "/csr-basic-same-origin",
    ],
    expectedExternalUrls: [
      "https://dynamic.example/csr-basic-external",
    ],
  },
  {
    id: "csr-delayed",
    file: "csr-delayed.html",
    path: "/fixtures/csr-delayed",
    expectedPaths: [
      "/csr-delayed-target",
    ],
    delayMs: 250,
  },
  {
    id: "duplicate-link",
    file: "duplicate-link.html",
    path: "/fixtures/duplicate-link",
    expectedPaths: [
      "/duplicate-link/shared-target",
    ],
    duplicateCanonicalPath: "/duplicate-link/shared-target",
  },
  {
    id: "runtime-base-url",
    file: "runtime-base-url.html",
    path: "/fixtures/runtime-base-url",
    expectedPaths: [
      "/runtime-base/relative-target",
    ],
    runtimeHistoryPath: "/runtime-history/current-page",
    runtimeBasePath: "/runtime-base/",
  },
];

const dynamicScanFixtures = Object.fromEntries(
  fixtureDefinitions.map((fixture) => [fixture.id, fixture]),
);

async function readDynamicScanFixture(id) {
  const fixture = dynamicScanFixtures[id];
  if (!fixture) {
    throw new Error(`Unknown dynamic scan fixture: ${id}`);
  }
  return readFile(join(fixtureDir, fixture.file), "utf8");
}

function getDynamicScanExpectedUrls(origin, id) {
  const fixture = dynamicScanFixtures[id];
  if (!fixture) {
    throw new Error(`Unknown dynamic scan fixture: ${id}`);
  }
  return [
    ...(fixture.expectedPaths || []).map((path) => new URL(path, origin).toString()),
    ...(fixture.expectedExternalUrls || []),
  ];
}

function createDynamicScanFixtureServer() {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const fixture = fixtureDefinitions.find((candidate) => candidate.path === requestUrl.pathname);

    if (requestUrl.pathname === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    if (fixture) {
      const filePath = join(fixtureDir, fixture.file);
      response.writeHead(200, {
        "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
      });
      createReadStream(filePath).pipe(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Target</title></head>
<body><p>Target ${requestUrl.pathname}</p></body>
</html>`);
  });

  return {
    async start() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      return {
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        }),
      };
    },
  };
}

export {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
  getDynamicScanExpectedUrls,
  readDynamicScanFixture,
};
