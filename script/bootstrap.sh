#!/bin/bash

set -e

sha=$(shasum package-lock.json)
sha_file="deploy/package-lock.checksum"

run () {
    echo "Installing dependencies..."
    npm install --save --quiet > /dev/null

    # Running twice fixes missing
    npm install --save --quiet > /dev/null

    echo "${sha}" > "${sha_file}"
}

if test -f "${sha_file}"; then
    old_sha=$(cat $sha_file)
    if [[ "${old_sha}" != "${sha}" ]]; then
        run
    fi
else
    run
fi

