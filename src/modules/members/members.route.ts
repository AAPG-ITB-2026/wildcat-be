import { Hono } from 'hono';
import { handleUpdateMemberInfo } from './members.controller.js';

const membersRoute = new Hono()

membersRoute.get('/', (c) => {
  return c.json({
    message: "Members endpoint is working",
    timestamp: new Date().toISOString(),
    debug: true
  });
});
membersRoute.patch('/:id', handleUpdateMemberInfo)

export default membersRoute
