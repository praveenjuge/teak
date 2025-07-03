#!/bin/bash

# Helper script to ensure Node.js v20 is being used
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 20
elif [[ -s "$HOME/.nvm/nvm.sh" ]] && [[ -s "$HOME/.nvm/bash_completion" ]]; then
    source "$HOME/.nvm/nvm.sh"
    source "$HOME/.nvm/bash_completion"
    nvm use 20
else
    echo "Warning: nvm not found. Make sure Node.js v20 is installed and active."
fi