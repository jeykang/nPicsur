# syntax=docker/dockerfile:1

# Build with:   docker build -t picsur .
# The image runs Picsur on port 8080, see the README for configuration.

ARG NODE_IMAGE=node:24-alpine3.24

# libvips is built from source, because the version bundled with sharp can
# not read HEIC (iPhone photos), JPEG XL or JPEG 2000. Only the formats Picsur
# supports are enabled, loaders for things like PDF, SVG or ImageMagick are
# left out entirely.
ARG VIPS_VERSION=8.18.6
ARG VIPS_SHA256=3c41e1d5458081bfa4a5bc54e116c46259c75c6760a18027764555632b9dda3e

# ------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS vips
ARG VIPS_VERSION
ARG VIPS_SHA256

RUN apk add --no-cache \
      build-base meson pkgconf \
      glib-dev expat-dev zlib-dev \
      libjpeg-turbo-dev libpng-dev libspng-dev libwebp-dev tiff-dev \
      libheif-dev libjxl-dev openjpeg-dev cgif-dev \
      libexif-dev lcms2-dev libimagequant-dev highway-dev

WORKDIR /build
RUN wget -q "https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz" \
 && echo "${VIPS_SHA256}  vips-${VIPS_VERSION}.tar.xz" | sha256sum -c - \
 && tar -xf "vips-${VIPS_VERSION}.tar.xz" \
 && cd "vips-${VIPS_VERSION}" \
 && meson setup build --prefix=/usr/local --libdir=lib --buildtype=release \
      -Ddeprecated=false -Dexamples=false -Dcplusplus=true \
      -Dmodules=disabled -Dintrospection=disabled \
      -Djpeg=enabled -Dpng=enabled -Dspng=enabled -Dwebp=enabled \
      -Dtiff=enabled -Dheif=enabled -Djpeg-xl=enabled -Dopenjpeg=enabled \
      -Dcgif=enabled -Dnsgif=true -Dexif=enabled -Dlcms=enabled \
      -Dimagequant=enabled -Dhighway=enabled -Dzlib=enabled \
      -Dmagick=disabled -Dpoppler=disabled -Dpdfium=disabled -Drsvg=disabled \
      -Dcfitsio=disabled -Dopenexr=disabled -Dopenslide=disabled \
      -Dmatio=disabled -Dnifti=disabled -Draw=disabled -Duhdr=disabled \
      -Darchive=disabled -Dfftw=disabled -Dorc=disabled -Dquantizr=disabled \
      -Dpangocairo=disabled -Dfontconfig=disabled \
      -Dppm=false -Danalyze=false -Dradiance=false \
 && meson compile -C build \
 && meson install -C build \
 && rm -rf /build

# ------------------------------------------------------------------------------
# The JavaScript does not depend on the platform, so it is built once on the
# build machine instead of under emulation for every platform.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build

RUN corepack enable
WORKDIR /picsur

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY branding branding
COPY shared shared
COPY frontend frontend
COPY backend backend
RUN pnpm --filter picsur-shared build \
 && pnpm --filter picsur-frontend build \
 && pnpm --filter picsur-backend build

# ------------------------------------------------------------------------------
# Production dependencies, with sharp compiled against the libvips from above
FROM vips AS deps

# Native addons are compiled against the headers that come with Node, instead
# of downloading them
ENV npm_config_nodedir=/usr/local
RUN apk add --no-cache python3 \
 && npm install -g node-gyp@12 node-addon-api@8 \
 && corepack enable
WORKDIR /picsur

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --prod

RUN cd backend/node_modules/sharp \
 && NODE_PATH="$(npm root -g)" SHARP_FORCE_GLOBAL_LIBVIPS=1 node install/build.js \
 && rm -rf src/build/Release/obj.target src/build/Release/.deps

# ------------------------------------------------------------------------------
FROM ${NODE_IMAGE}

COPY --from=vips /usr/local/lib/ /usr/local/lib/
COPY --from=deps --chown=root:root /picsur /picsur
COPY --from=build /picsur/shared/dist /picsur/shared/dist
COPY --from=build /picsur/backend/dist /picsur/backend/dist
COPY --from=build /picsur/frontend/dist /picsur/frontend/dist
COPY branding /picsur/branding

# Install exactly the shared libraries that libvips and the native addons link
# against, plus tini to forward signals and reap the image worker processes.
# Alpine splits libheif's codecs into plugins and only installs the decoders
# by default, the AV1 encoder is needed to write AVIF and HEIF.
RUN apk add --no-cache --virtual .scan pax-utils \
 && runDeps="$(scanelf --needed --nobanner --format '%n#p' --recursive /usr/local/lib /picsur/node_modules \
      | tr ',' '\n' | sort -u \
      | awk 'system("[ -e /usr/local/lib/" $1 " ]") == 0 { next } { print "so:" $1 }')" \
 && apk add --no-cache $runDeps libheif-aom tini \
 && apk del .scan

# Fail the build, rather than publish an image that can not handle one of the
# formats Picsur supports
RUN --mount=type=bind,source=backend/test/e2e/fixtures/hevc.heic,target=/tmp/hevc.heic \
    node <<'EOF'
const sharp = require('/picsur/backend/node_modules/sharp');
(async () => {
  const image = sharp({
    create: { width: 16, height: 16, channels: 3, background: '#ff8000' },
  });
  for (const format of ['jpeg', 'png', 'webp', 'tiff', 'gif', 'avif', 'jxl', 'jp2']) {
    const data = await image.clone().toFormat(format).toBuffer();
    const { info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 16) throw new Error(`Could not read back ${format}`);
  }
  // Photos from phones are HEIC, which libheif reads with the libde265 plugin
  const { info } = await sharp('/tmp/hevc.heic').raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 64) throw new Error('Could not read HEIC');
  console.log(`libvips ${sharp.versions.vips} handles every format`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
EOF

ENV NODE_ENV=production \
    PICSUR_PRODUCTION=true \
    PICSUR_HOST=0.0.0.0 \
    PICSUR_PORT=8080

WORKDIR /picsur
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/info || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/main.js"]
