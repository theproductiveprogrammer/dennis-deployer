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

“Do all this again Dennis”

“Cheerfully Boss!”

Dennis reads his instructions from a file.

```sh
$> npm start <deployment instructions> <dest>
# Eg: npm start deploy_everything {myserver}
```

There are a couple instructions that Dennis understands:

```sh
copy "path/to/src" to "path/to/dest"
run "some command" in "some location"
let var = value
do "path/to/other/instructions"
# Comment
```

Here’s a sample set of deployment instructions he’d understand:

```sh
# Test deployment file (test.dpi)
let src = {pwd}
let local = {pwd}/../DST-TST
let myserver = user@server:/home/user/dst-tst -p 22

let repo = myrepo
do "{here}/upload_repo.dpi"

let repo = another_repo
do "{here}/upload_repo.dpi"

tellme All Done!

```

```sh
# upload_repo.dpi

# create a new bare repository
# note that using the pattern "|| true"  causes dennis to ignore errors in the run just like in bash
run "rm -rf {tmp}/{repo}.git || true" in "{tmp}"
run "git clone --bare {src}/{repo}" in "{tmp}"

# step back so that we can do an initial push
run "git update-ref HEAD HEAD^" in "{tmp}/{repo}.git"

# copy the post-receive hook
copy "{here}/post-receive" to "{tmp}/{repo}.git/hooks/post-receive"
run "chmod +x post-receive" in "{tmp}/{repo}.git/hooks"

# DEPLOY! (either locally or to the server)
copy "{tmp}/{repo}.git" to "{dst}/REPOS/{repo}.git"

# link up local and remote repo
run "git remote rm {dst} || true" in "{town}/myrepo"
run "git remote add {dst} {dst}/REPOS/{repo}.git" in "{town}/myrepo"

# do an initial push
run "git push -q {dst}" in "{town}/myrepo"
```

## Deployment Variables

You can set any deployment variables in the file and reference them using the `{var}` syntax. The following variables are avaiable by default because they are useful for any deployment:

| variable name | description                                                  |
| ------------- | :----------------------------------------------------------- |
| dst           | name of destination<br />e.g: npm start test.dpi local<br />{dst} == local |
| here          | location of these instructions                               |
| name          | instructions name (without extension)<br />e.g: `npm start test.dpi local`<br />`{name}` == test<br />`{here}/{name}.dpi` gives the full path to the instructions |
| pwd           | present working directory                                    |
| tmp           | temporary directory location                                 |

## Motivation

Having to deploy new repositories on different servers is a pain - create a new bare repo, add a hook, tar & gzip, then scp it across, ssh to untar etc.

Dennis does all this neatly with a script that can work locally or on any server transparenly. It’s simple, nice, and usable.

---
