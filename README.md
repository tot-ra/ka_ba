## ai command line command
This requires [LM Studio](https://lmstudio.ai/) running

### Usage
Easy interaction
```
ai hi                                                                                                                                                   ✔  34s  git Py 
It's nice to meet you. Is there anything I can help you with or would you like to chat?
```


Piping:
```
cat ai.go | ai
```

Questioning:
```
(echo -e "what do you think about these files?"; ls) | ai
```


### Installation
```
git clone https://github.com/tot-ra/ai-cli.git ~/ai-cli
cd ai-cli && go build ai.go
echo "source alias ai=~/ai-cli/ai" >> ~/.zshrc
```
