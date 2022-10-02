#!/bin/bash

set -e

sha=$(shasum package-lock.json)
sha_file="deploy/package-lock.checksum"

run () {
    echo "Installing dependencies..."

    # Running twice fixes missing
    npm install && npm install

    echo "${sha}" > "${sha_file}"
}

run
# if test -f "${sha_file}"; then
#     old_sha=$(cat $sha_file)
#     if [[ "${old_sha}" != "${sha}" ]]; then
#         run
#     fi
# else
#     run
# fi
#
