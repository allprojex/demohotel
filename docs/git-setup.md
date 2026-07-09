# Git Setup

The intended remote repository is:

```bash
https://github.com/allprojex/hotelms.git
```

This workspace should never commit `.env` or other real secret files.

For a fresh local checkout:

```bash
git init
git branch -M main
git remote add origin https://github.com/allprojex/hotelms.git
git add .
git commit -m "Prepare Hostinger VPS deployment"
git push -u origin main
```

If GitHub asks for authentication, use GitHub CLI, SSH, or a personal access token configured outside this repository.
