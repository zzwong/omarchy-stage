-- Offline workspace-activation fixture. Runs the actual generated expression,
-- not a translation of its guards. No compositor, QML, shell or socket API.
-- An existing workspace belongs to its owner; a new one follows the active
-- monitor unless this fixture explicitly supplies a placement rule.
local worlds = {
  free = { active = 1 },
  zero = { active = 0 },
  remote = { active = 1, existing = 2 },
  localcollision = { active = 1, existing = 1 },
  nomonitor = {},
  changed = { active = 2 },
  rule = { active = 1, rule = 2 },
}
local world = assert(worlds[arg[1]], 'unknown world')
local calls, focused, workspace = 0, world.active, 0
hl = {
  get_active_monitor = function()
    return world.active ~= nil and { id = world.active } or nil
  end,
  get_workspace = function(id)
    assert(type(id) == 'number' and id == 4, 'expected numeric candidate 4')
    return world.existing ~= nil and { id = id, monitor = { id = world.existing } } or nil
  end,
  dsp = {
    focus = function(args)
      assert(type(args.workspace) == 'number' and args.workspace == 4,
             'only workspace 4 focus is allowed in this fixture')
      assert(args.monitor == nil and args.on_current_monitor == nil,
             'creation must not override monitor placement policy')
      return function()
        calls = calls + 1
        workspace = args.workspace
        focused = world.existing or world.rule or world.active
      end
    end,
  },
  dispatch = function(command)
    assert(type(command) == 'function', 'expected dispatcher or closure')
    return command()
  end,
}
local expression = assert(load('return ' .. io.read('*a'), 'StageWorkspace', 't', { hl = hl }))()
hl.dispatch(expression)
print(string.format('%d %s %d', calls, tostring(focused), workspace))
