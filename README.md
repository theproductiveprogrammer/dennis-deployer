# Dennis The Deployer

Dennis the deployer helps you deploy your latest changes to various deployments both on your machine or on any ssh cloud server.

![dennis](./dennis-the-deployer.png)

Give Dennis instructions and he’s your boy!

Deploy locally or to a server! Dennis can do it all!

“Copy this directory over Dennis!”

“No problems boss!”

“Copy this file over Dennis!”

“Easy job boss!”

“Tell me when you’re done Dennis”

“I’ll keep you posted boss”

“Run this command in this folder Dennis”

“Ok boss but I can’t be held responsible if it blows up!”

Dennis reads his instructions from a file. Every set of instructions starts with setting the `{SRC}` and `{DST}` locations. Dennis also understands how to use a `{TMP}` location (where it is actually is up to him).

Here’s a sample set of deployment instructions he’d understand:

```sh
# Test deployment file
src: {pwd}/..
#dst: {pwd}/../DST-TST
dst: user@server:/home/user/dst-tst -p 22

# create a new bare repository
# using the standard pattern "|| true" tells dennis to ignore errors in the run
run "rm -rf {tmp}/myrepo.git || true" in {tmp}
run "git clone --bare {src}/myrepo" in {tmp}

# step back so that we can do an initial push
run "git update-ref HEAD HEAD^" in {tmp}/myrepo.git

# copy the post-receive hook
copy {pwd}/post-receive {tmp}/myrepo.git/hooks/post-receive
run "chmod +x post-receive" in {tmp}/myrepo.git/hooks

# DEPLOY! (works both locally and on any server)
copydir {tmp}/myrepo.git {dst}/_REPOS/myrepo.git

# link up local and remote repo
run "git remote rm {deploy} || true" in {src}/myrepo
run "git remote add {deploy} {dst}/_REPOS/myrepo.git" in {src}/myrepo

# do an initial push
run "git push -q {deploy}" in {src}/myrepo

tellme All Done!

```

## Motivation

Having to deploy new repositories on different servers is a pain - create a new bare repo, add a hook, tar & gzip, then scp it across, ssh to untar etc.

Dennis does all this neatly with a script that can work locally or on any server transparenly. It’s simple, nice, and usable.

---
