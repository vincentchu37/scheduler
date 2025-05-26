# Event scheduler app
## Got tired of using when2meet so here we are!

I totally vibe coded this in like 2 days so run at your own risk. I do have the full power of gitlab's security suite aimed at this and it seems to be alright. 

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