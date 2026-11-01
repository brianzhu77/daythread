from native import *
ctx('NATIVE_APP')
for _ in range(3):call('execute/sync',{'script':'mobile: dragFromToForDuration','args':[{'duration':.5,'fromX':160,'fromY':270,'toX':160,'toY':100}]})
time.sleep(.3);shot('native-last')
web=call('contexts',method='GET')[-1];ctx(web)
print(js('''const m=document.querySelector('#bn-suggestion-menu'),o=[...m.querySelectorAll('[role=option]')].at(-1);return {menu:m.getBoundingClientRect().toJSON(),last:o.getBoundingClientRect().toJSON(),scroll:m.scrollTop,text:o.textContent};'''))
ctx('NATIVE_APP');key('Separator');time.sleep(.5)
ctx(web);print(js('return {dividers:document.querySelectorAll(".continuous-editor [data-content-type=divider]").length,width:innerWidth,vv:visualViewport.height}'))
