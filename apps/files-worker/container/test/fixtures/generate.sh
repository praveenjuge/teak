#!/usr/bin/env bash
# Regenerates the renderer integration-test fixtures in this directory.
# Needs ffmpeg (with libx264, libx265, libvpx-vp9, libsvtav1, libopus,
# libmp3lame), qpdf and bun. Every file stays well under 50 KB.
#
#   apps/files-worker/container/test/fixtures/generate.sh
set -euo pipefail
cd "$(dirname "$0")"

ff() { ffmpeg -nostdin -hide_banner -loglevel error -y "$@"; }

# 3 s, 160×96, 10 fps test pattern with a keyframe every second, so the
# scrub sprite's keyframe seeks land on distinct frames.
video="-f lavfi -i testsrc=size=160x96:duration=3:rate=10"
tone="-f lavfi -i sine=frequency=440:duration=3:sample_rate=8000"

ff $video $tone -c:v libx264 -g 10 -pix_fmt yuv420p -c:a aac -b:a 16k -ac 1 -shortest h264.mp4
ff -display_rotation 90 -i h264.mp4 -c copy rotated.mov
ff $video -c:v libvpx-vp9 -g 10 -b:v 50k vp9.webm
ff $video -c:v libx265 -g 10 -pix_fmt yuv420p -x265-params log-level=error hevc.mp4
SVT_LOG=1 ff $video -c:v libsvtav1 -g 10 -pix_fmt yuv420p av1.mp4
ff $video $tone -c:v libx264 -g 10 -pix_fmt yuv420p -c:a libopus -b:a 16k -ac 1 -shortest video.mkv
ff $video -c:v mpeg4 -g 10 -q:v 10 video.avi

ff -f lavfi -i "color=c=red:s=32x32:d=1:r=4" -f lavfi -i "color=c=blue:s=32x32:d=1:r=4" \
  -filter_complex "[0][1]concat=n=2:v=1" animation.gif

swell="-f lavfi -i sine=frequency=330:duration=2:sample_rate=8000 -af volume=eval=frame:volume=sin(PI*t/2)"
ff $swell -ac 1 -c:a libmp3lame -b:a 32k audio.mp3
ff $swell -ac 1 -c:a pcm_s16le audio.wav
ff $swell -ac 1 -ar 48000 -c:a libopus -b:a 16k audio.ogg
ff $swell -ac 1 -c:a flac audio.flac
ff $swell -ac 1 -c:a aac -b:a 16k audio.m4a

bun make-pdf.ts 60 sixty-pages.pdf
bun make-pdf.ts 1 no-text.pdf --no-text
qpdf --encrypt user-secret owner-secret 256 -- sixty-pages.pdf encrypted.pdf

head -c 4096 h264.mp4 > truncated.mp4
head -c 4096 /dev/urandom > garbage.pdf

cat > playlist.m3u8 <<'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
file:///etc/passwd
#EXTINF:10.0,
http://example.com/segment.ts
#EXT-X-ENDLIST
EOF
cat > list.ffconcat <<'EOF'
ffconcat version 1.0
file /etc/passwd
file h264.mp4
EOF

ls -l
