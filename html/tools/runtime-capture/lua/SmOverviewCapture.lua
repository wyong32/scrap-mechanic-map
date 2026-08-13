SmOverviewCapture = {}

function SmOverviewCapture.bind( self )
    sm.game.bindChatCommand( "/smoverview_capture", {
        { "number", "x", false },
        { "number", "y", false },
        { "number", "z", false }
    }, "cl_onChatCommand", "Set the audited overview capture camera" )
    sm.game.bindChatCommand( "/smoverview_capture_off", {}, "cl_onChatCommand", "Disable the overview capture camera" )
end

function SmOverviewCapture.handleClient( self, params )
    if params[1] == "/smoverview_capture" then
        local position = sm.vec3.new( params[2], params[3], params[4] )
        self.cl.smOverviewCapture = { position = position, fov = 90 }
        self.network:sendToServer( "sv_smOverviewCaptureTeleport", { position = position } )
        print( string.format( "SM_OVERVIEW_CAPTURE_READY x=%.3f y=%.3f z=%.3f fov=90 direction=0,0,-1 gui=hidden", params[2], params[3], params[4] ) )
        return true
    elseif params[1] == "/smoverview_capture_off" then
        self.cl.smOverviewCapture = nil
        sm.gui.hideGui( false )
        sm.localPlayer.setLockedControls( false )
        print( "SM_OVERVIEW_CAPTURE_OFF" )
        return true
    end
    return false
end

function SmOverviewCapture.update( self )
    local capture = self.cl.smOverviewCapture
    if capture == nil then return end
    sm.gui.hideGui( true )
    sm.localPlayer.setLockedControls( true )
    sm.camera.setCameraState( sm.camera.state.scriptedTP )
    sm.camera.setPosition( capture.position )
    sm.camera.setDirection( sm.vec3.new( 0, 0, -1 ) )
    sm.camera.setFov( capture.fov )
end

function SmOverviewCapture.teleport( self, params, player )
    local pos = params.position
    local cellX, cellY = math.floor( pos.x / 64 ), math.floor( pos.y / 64 )
    self.sv.saved.overworld:loadCell( cellX, cellY, player, "sv_recreatePlayerCharacter", {
        pos = pos,
        dir = sm.vec3.new( 0, 1, 0 )
    } )
end
