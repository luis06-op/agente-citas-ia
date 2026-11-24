#!/usr/bin/env bash
set -euo pipefail

DIR="$HOME/.local/opt/llama.cpp"
DATOS="$HOME/.local/share/llama.cpp"
ESTADO="${XDG_STATE_HOME:-$HOME/.local/state}/llama.cpp"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/agente-citas"
MODELO="$DATOS/models/qwen2.5-1.5b-instruct-q4_k_m.gguf"
VERSION=b12681
PUERTO="${LOCAL_PORT:-8088}"
URL="http://127.0.0.1:$PUERTO"
mkdir -p "$ESTADO"

activo() { curl -fsS --max-time 2 "$URL/health" >/dev/null 2>&1; }

instalar() {
    mkdir -p "$DIR" "$CACHE" "$(dirname "$MODELO")"
    if [ ! -x "$DIR/llama-server" ]; then
        echo 'Descargando llama.cpp para Linux x86_64 (22 MB)…'
        curl -fL --retry 3 -C - -o "$CACHE/llama-$VERSION.tar.gz" \
            "https://github.com/ggml-org/llama.cpp/releases/download/$VERSION/llama-$VERSION-bin-ubuntu-x64.tar.gz"
        tar -xzf "$CACHE/llama-$VERSION.tar.gz" -C "$DIR" --strip-components=1
    fi
    if [ ! -f "$MODELO" ]; then
        echo 'Descargando Qwen 2.5 1.5B (aproximadamente 1 GB)…'
        curl -fL --retry 3 -C - -o "$MODELO.part" \
            'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
        echo "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e  $MODELO.part" | sha256sum -c -
        mv "$MODELO.part" "$MODELO"
    fi
}

iniciar() {
    if activo; then return 0; fi
    if [ ! -x "$DIR/llama-server" ] || [ ! -f "$MODELO" ]; then
        echo 'Falta instalar el motor o el modelo. Ejecuta: npm run preparar' >&2
        return 1
    fi
    nohup "$DIR/llama-server" -m "$MODELO" --alias "${OPENAI_MODEL:-qwen2.5-local}" \
        --host 127.0.0.1 --port "$PUERTO" -ngl 0 -c 8192 -np 1 -t 4 \
        >"$ESTADO/servidor.log" 2>&1 </dev/null &
    local pid=$!
    echo "$pid" >"$ESTADO/servidor.pid"
    for ((i=0; i<120; i++)); do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        if activo; then
            echo "Motor local listo en $URL"
            return 0
        fi
        sleep 1
    done
    echo "El motor no arrancó. Revisa $ESTADO/servidor.log" >&2
    return 1
}

detener() {
    if [ -f "$ESTADO/servidor.pid" ]; then
        local pid
        pid=$(cat "$ESTADO/servidor.pid")
        if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$(readlink "/proc/$pid/exe" 2>/dev/null || true)" = "$DIR/llama-server" ]; then
            kill "$pid"
        fi
        rm -f "$ESTADO/servidor.pid"
    fi
}

case "${1:-}" in
    preparar) instalar; iniciar ;;
    iniciar) iniciar ;;
    auto)
        if [ -x "$DIR/llama-server" ] && [ -f "$MODELO" ]; then iniciar; fi
        ;;
    estado) curl -fsS "$URL/v1/models" ;;
    detener) detener ;;
    *) echo 'Uso: llama.sh {preparar|iniciar|auto|estado|detener}' >&2; exit 1 ;;
esac
