## ai command line command
This requires [LM Studio](https://lmstudio.ai/) running, so install it and also [lms cli](https://lmstudio.ai/blog/lms)
`lms server start`

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

Blindly trust the machine
```
$(ai "generate a CLI command to list hidden files, return only one command for mac so that it could be executed with eval, nothing else. NOTHING ELSE, avoid quotes")
```


### Installation
```
git clone https://github.com/tot-ra/ai-cli.git ~/ai-cli
cd ai-cli && go build ai.go
echo "source alias ai=~/ai-cli/ai" >> ~/.zshrc
```
