# Event scheduler

I wanted a self hosted when2meet alternative while making some (imo) ui improvments. 

**Make all contributions on Gitlab: https://gitlab.com/quickbrownfoxes/scheduler**

Try it here:

https://scheduler.quickbrownfoxes.org/

![screnshot](image.png)

## Self Hosting

the `/app/db` folder needs to be writable by 1000:1000 (application user in the container) for sqlite db and WAL files.

### Docker deployment
```
services:
  scheduler:
    container_name: scheduler
    image: registry.gitlab.com/quickbrownfoxes/scheduler
    environment:
      - WEB_DOCUMENT_INDEX=index.html
    volumes:
      - /home/vincent/scheduler/:/app/db
```

### Regular fpm deployment
Git clone, and deploy run out of the `app` directory. 

Permissions required to run this app. 
Where `82` is the userid of your fpm process!

```
chown :82 scheduler
chmod 775 scheduler
```

```
vincent@3:~/webapps/scheduler$ ls -la
total 128
drwxrwxr-x 3 vincent      82  4096 May 26 03:58 .
```