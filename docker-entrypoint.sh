#!/bin/sh
set -eu

upload_dir="${RAILWAY_VOLUME_MOUNT_PATH:-${UPLOAD_DIR:-/app/uploads}}"
case "$upload_dir" in
  /*) ;;
  ./app/*) upload_dir="/app/${upload_dir#./app/}" ;;
  app/*) upload_dir="/app/${upload_dir#app/}" ;;
  ./*) upload_dir="/app/${upload_dir#./}" ;;
  *) upload_dir="/app/$upload_dir" ;;
esac

mkdir -p "$upload_dir"
chown -R node:node "$upload_dir"
exec su-exec node "$@"
