var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (app, router) {

  // ---------- helpers ----------
  const parseJSON = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

  const buildQuery = (modelOrQuery, q, { isTasks } = {}) => {
    // Accept Model or Query (for findById)
    let query = (typeof modelOrQuery.find === 'function')
      ? modelOrQuery.find(parseJSON(q.where, {}))
      : modelOrQuery; // already a query (e.g., findById)

    if (q.sort)   query = query.sort(parseJSON(q.sort, {}));
    if (q.select) query = query.select(parseJSON(q.select, {}));
    if (q.skip)   query = query.skip(parseInt(q.skip, 10) || 0);

    // default limit=100 for tasks (unless count=true or explicit limit provided)
    if (q.count !== 'true') {
      if (q.limit) {
        query = query.limit(parseInt(q.limit, 10) || 0);
      } else if (isTasks) {
        query = query.limit(100);
      }
    }
    return query;
  };

  const send = (res, code, message, data=null) => res.status(code).json({ message, data });

  // Keep task.pendingTasks in sync with user.pendingTasks
  async function addPendingToUser(userId, taskId) {
    if (!userId || !taskId) return;
    await User.updateOne({ _id: userId, pendingTasks: { $ne: taskId } }, { $push: { pendingTasks: taskId } });
  }
  async function removePendingFromUser(userId, taskId) {
    if (!userId || !taskId) return;
    await User.updateOne({ _id: userId }, { $pull: { pendingTasks: taskId } });
  }

  async function resolveUserName(userId) {
    if (!userId) return 'unassigned';
    const u = await User.findById(userId).select({ name: 1 });
    return u ? u.name : 'unassigned';
  }

  // ---------- USERS ----------
  router.route('/users')
    // GET list of users with JSON query params
    .get(async (req, res) => {
      try {
        if (req.query.count === 'true') {
          const n = await User.countDocuments(parseJSON(req.query.where, {}));
          return send(res, 200, 'OK', n);
        }
        const users = await buildQuery(User, req.query, { isTasks: false }).exec();
        return send(res, 200, 'OK', users);
      } catch (e) {
        return send(res, 400, 'Bad request (users query)', String(e));
      }
    })
    // POST create user with validation + unique email
    .post(async (req, res) => {
      try {
        const { name, email } = req.body || {};
        if (!name || !email) return send(res, 400, 'Missing required fields (name, email)');
        const dup = await User.findOne({ email: email.toLowerCase().trim() });
        if (dup) return send(res, 400, 'User with that email already exists');
        const user = new User({ ...req.body, email: email.toLowerCase().trim() });
        await user.save();
        return send(res, 201, 'User created', user);
      } catch (e) {
        return send(res, 500, 'Server error creating user', String(e));
      }
    });

  router.route('/users/:id')
    // GET user by id + support select param
    .get(async (req, res) => {
      try {
        let q = User.findById(req.params.id);
        if (req.query.select) q = q.select(parseJSON(req.query.select, {}));
        const user = await q.exec();
        if (!user) return send(res, 404, 'User not found');
        return send(res, 200, 'OK', user);
      } catch (e) {
        return send(res, 400, 'Invalid user id', String(e));
      }
    })
    // PUT replace entire user (also sync pendingTasks two-way)
    .put(async (req, res) => {
      try {
        const { name, email, pendingTasks } = req.body || {};
        if (!name || !email) return send(res, 400, 'Missing required fields (name, email)');

        const prev = await User.findById(req.params.id);
        if (!prev) return send(res, 404, 'User not found');

        // Update user document
        const updated = await User.findByIdAndUpdate(
          req.params.id,
          { name, email: email.toLowerCase().trim(), pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : prev.pendingTasks },
          { new: true }
        );
        if (!updated) return send(res, 404, 'User not found after update');

        // Two-way sync: tasks in new pendingTasks should point to this user,
        // tasks removed from pendingTasks should be unassigned
        if (Array.isArray(pendingTasks)) {
          const prevSet = new Set((prev.pendingTasks || []).map(String));
          const nextSet = new Set((pendingTasks || []).map(String));

          const removed = [...prevSet].filter(id => !nextSet.has(id));
          const added   = [...nextSet].filter(id => !prevSet.has(id));

          // Unassign removed tasks
          await Task.updateMany(
            { _id: { $in: removed }, assignedUser: String(prev._id) },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
          );

          // Assign added tasks to this user
          const uname = updated.name;
          await Task.updateMany(
            { _id: { $in: added } },
            { $set: { assignedUser: String(updated._id), assignedUserName: uname } }
          );
        }

        return send(res, 200, 'User updated', updated);
      } catch (e) {
        return send(res, 500, 'Server error updating user', String(e));
      }
    })
    // DELETE user (unassign that user’s pending tasks)
    .delete(async (req, res) => {
      try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return send(res, 404, 'User not found');
        await Task.updateMany(
          { assignedUser: String(req.params.id) },
          { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
        return send(res, 200, 'User deleted (tasks unassigned)');
        // If you want to use 204 per spec: res.status(204).end();
      } catch (e) {
        return send(res, 500, 'Server error deleting user', String(e));
      }
    });

  // ---------- TASKS ----------
  router.route('/tasks')
    // GET list of tasks, default limit=100, supports count
    .get(async (req, res) => {
      try {
        if (req.query.count === 'true') {
          const n = await Task.countDocuments(parseJSON(req.query.where, {}));
          return send(res, 200, 'OK', n);
        }
        const tasks = await buildQuery(Task, req.query, { isTasks: true }).exec();
        return send(res, 200, 'OK', tasks);
      } catch (e) {
        return send(res, 400, 'Bad request (tasks query)', String(e));
      }
    })
    // POST create task + set assignedUserName + sync user.pendingTasks
    .post(async (req, res) => {
      try {
        const { name, deadline, assignedUser, completed } = req.body || {};
        if (!name || !deadline) return send(res, 400, 'Missing required fields (name, deadline)');

        const assignedUserName = await resolveUserName(assignedUser);
        const task = new Task({ ...req.body, assignedUserName });

        await task.save();

        // If assigned to a user AND not completed -> add to user.pendingTasks
        if (assignedUser && !completed) {
          await addPendingToUser(assignedUser, String(task._id));
        }
        return send(res, 201, 'Task created', task);
      } catch (e) {
        return send(res, 500, 'Server error creating task', String(e));
      }
    });

  router.route('/tasks/:id')
    // GET task by id + support select param
    .get(async (req, res) => {
      try {
        let q = Task.findById(req.params.id);
        if (req.query.select) q = q.select(parseJSON(req.query.select, {}));
        const task = await q.exec();
        if (!task) return send(res, 404, 'Task not found');
        return send(res, 200, 'OK', task);
      } catch (e) {
        return send(res, 400, 'Invalid task id', String(e));
      }
    })
    // PUT replace task + sync both sides
    .put(async (req, res) => {
      try {
        const { name, deadline } = req.body || {};
        if (!name || !deadline) return send(res, 400, 'Missing required fields (name, deadline)');

        const prev = await Task.findById(req.params.id);
        if (!prev) return send(res, 404, 'Task not found');

        // Compute new assignedUserName from incoming assignedUser (can be '' or a valid id)
        const newAssignedUser = req.body.assignedUser || '';
        const newAssignedUserName = await resolveUserName(newAssignedUser);

        // Apply update
        const updated = await Task.findByIdAndUpdate(
          req.params.id,
          { ...req.body, assignedUserName: newAssignedUserName },
          { new: true }
        );

        // Sync user.pendingTasks:
        const prevUser = prev.assignedUser || '';
        const nextUser = updated.assignedUser || '';

        // If assignment changed, update both users’ pendingTasks
        if (prevUser && prevUser !== nextUser) await removePendingFromUser(prevUser, String(updated._id));
        if (nextUser && !updated.completed)   await addPendingToUser(nextUser, String(updated._id));

        // If task is completed now, ensure it’s not in pendingTasks
        if (updated.completed && nextUser) {
          await removePendingFromUser(nextUser, String(updated._id));
        }

        return send(res, 200, 'Task updated', updated);
      } catch (e) {
        return send(res, 500, 'Server error updating task', String(e));
      }
    })
    // DELETE task + remove from user.pendingTasks
    .delete(async (req, res) => {
      try {
        const task = await Task.findByIdAndDelete(req.params.id);
        if (!task) return send(res, 404, 'Task not found');
        if (task.assignedUser) await removePendingFromUser(task.assignedUser, String(task._id));
        return send(res, 200, 'Task deleted'); // Or use 204 with .end()
      } catch (e) {
        return send(res, 500, 'Server error deleting task', String(e));
      }
    });

  // mount
  app.use('/api', router);
};
